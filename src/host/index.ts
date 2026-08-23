// DSH Visual Workflow —— Host 半区插件入口。
//
// T-002 建立最小可加载骨架；T-015 完成装配：FlowStore 初始化、subagent/end 与
// agent/error 事件观察挂载、dispose 清理（幂等）。编排运行时（运行锁/快照/状态机、
// wf_* 工具、GUI API、服务管理器）分别在 T-021/T-023/T-026/T-031 装配。
//
// 装配原则（SKILL §4.3 Effect 所有权）：所有长生命周期资源（事件监听、定时器、
// 存储句柄）都归当前 fiber——ctx.on 随 fiber 自动反注册，显式清理经 ctx.effect
// 返回的 disposer 执行；Service.init 失败让 fiber 失败（不吞错）。
//
// 取证结论（T-002/T-015）：
//   - z 来自 @deepseek-ai/schemastery（默认导出）；Service/Context 来自
//     @deepseek-ai/cordis（官方 packages/host/webserver/src/index.ts 同款）。
//   - cordis 4.x 内置 Events 无 dispose 事件 → 清理归 ctx.effect（SKILL §4.3）。
//   - 事件名 'subagent/end' / 'agent/error' 见本地 events.d.ts 声明（W-05）。

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FlowStore } from './storage/flow-store.js'

// 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。
export const name = 'dsh-visual-workflow'

// 必需 service 声明（W-05：所有 @deepseek-ai/* 服务经 ctx.get() 运行时解析）。
// 宿主插件不声明强依赖官方 service（inject 为空）：数据层自持，事件经 ctx.on
// 订阅——任何缺失的官方能力都在 Service.init 内以运行时解析+明确报错处理。
export const inject: string[] = []

// ── Config schema ────────────────────────────────────────────────────────
// 与 cordis.patch.yml 的 13 个配置键一一对应，默认值与 patch 逐字一致。
// 默认值收敛在 schema（SKILL §4.1：任何部署可能需要改变的值都应成为配置而非源码常量）。

/** Host 插件的全部可配置键（已含默认值，应用后为必填）。 */
export interface Config {
  /** 数据根目录（工作流/服务/模板/运行历史/断点的落盘目录）。 */
  dataDir: string
  /** 模式二服务端口池起始值（向上探测空闲端口）。 */
  servicePortBase: number
  /** 模式二 REST API 鉴权密钥；null 表示鉴权关闭。 */
  apiKey: string | null
  /** 模式二单服务并发请求上限。 */
  maxConcurrentPerService: number
  /** wf_ask_agent 阻塞通信超时毫秒数。 */
  wfAskAgentTimeoutMs: number
  /** 运行空闲超时毫秒数（无 in-flight 看护门限）。 */
  runIdleTimeoutMs: number
  /** 运行状态回显轮询间隔毫秒数。 */
  runPollMs: number
  /** ReAct 迭代次数默认上限（软截停强制收尾）。 */
  reactIterationLimitDefault: number
  /** 单节点回流重试次数默认上限。 */
  retryLimitDefault: number
  /** 节点完整输出持久化字节上限。 */
  outputFullLimit: number
  /** 文本文件内容注入上下文字符上限。 */
  documentTextLimit: number
  /** 本地嵌入模型资产目录；null 用随包分发资产。 */
  embeddingModelDir: string | null
  /** 外部 OpenAI 兼容 /embeddings 端点；null 优先本地嵌入。 */
  embeddingEndpoint: string | null
}

/** 导出的 Config schema，供 Loader 校验与默认值填充（与官方 tool-fs L36 同款 `z<Config>`）。 */
export const Config: z<Config> = z.object({
  dataDir: z.string().default(''),
  servicePortBase: z.natural().default(7860),
  apiKey: z.union([z.string(), z.const(null)]).default(null),
  maxConcurrentPerService: z.natural().default(50),
  wfAskAgentTimeoutMs: z.natural().default(120000),
  runIdleTimeoutMs: z.natural().default(1800000),
  runPollMs: z.natural().default(2000),
  reactIterationLimitDefault: z.natural().default(50),
  retryLimitDefault: z.natural().default(3),
  outputFullLimit: z.natural().default(102400),
  documentTextLimit: z.natural().default(20000),
  embeddingModelDir: z.union([z.string(), z.const(null)]).default(null),
  embeddingEndpoint: z.union([z.string(), z.const(null)]).default(null),
})

// ── visualWorkflowHost Service ────────────────────────────────────────────
// 提供 `visualWorkflowHost` 稳定 service；T-021/T-023/T-026/T-031 在后续阶段
// 扩展运行时（编排器/工具/API/服务管理器）。

/** 提供给 ctx 的宿主 service 名称。 */
export const VisualWorkflowHostServiceName = 'visualWorkflowHost'

/**
 * 宿主 service：持有解析后的 config 与 FlowStore，挂载事件观察与清理。
 *
 * 状态边界：
 *   - 持久化状态全部落盘于 dataDir（FlowStore，T-012）；
 *   - 内存运行态（运行锁/快照/子代理表）由 T-021 编排器接管，本类只保留
 *     dispose 清理骨架与事件观察入口（onSubagentEnd/onAgentError 钩子）。
 */
export class VisualWorkflowHost extends Service {
  /** FlowStore 实例（dataDir 落盘数据层）。 */
  readonly store: FlowStore
  /** 是否已清理（dispose 幂等标记；私有实现，经 getter 暴露供测试断言）。 */
  private _disposed = false

  /** 已清理标记（dispose 后为 true；重复 dispose 幂等）。 */
  get disposed(): boolean {
    return this._disposed
  }

  constructor(
    ctx: Context,
    public readonly config: Config,
  ) {
    super(ctx, VisualWorkflowHostServiceName)
    this.store = new FlowStore(config.dataDir)
  }

  /** 启动装配（Service.init 语义：初始化失败让 fiber 失败，不吞错）。 */
  async [Service.init](): Promise<void> {
    // dataDir 必须非空：真实运行由 cordis.patch.yml 的 dshHomePath 在 Loader 求值期
    // 解析为绝对路径；单测/独立嵌入需显式传入（不静默回退 cwd——SKILL §4.6）。
    if (!this.config.dataDir || !this.config.dataDir.trim()) {
      throw new Error('[visual-workflow] 配置缺失：dataDir 未指定（cordis.patch.yml 未加载？）')
    }

    // 数据目录结构初始化（幂等；§6 目录规划）
    await this.store.init()

    // 事件观察（官方 seam 语义，架构文档 §8 #21/#22）：
    //   - subagent/end：节点子代理结束回写（T-021 填充状态机逻辑；当前钩子记录日志）
    //   - agent/error：父代理回合错误快速终止（T-021 填充护栏）
    // ctx.on 随本 fiber 自动反注册（SKILL §4.3），无需手动 removeListener。
    this.ctx.on('subagent/end', (payload) => this.onSubagentEnd(payload))
    this.ctx.on('agent/error', (payload) => this.onAgentError(payload))

    // 显式清理通道：fiber 卸载时执行（中止运行/中断子代理/停止看护——T-021/T-031 扩展）。
    this.ctx.effect(() => () => this.dispose(), 'visualWorkflowHost.dispose')

    this.ctx.logger.info(`[visual-workflow] host service ready at ${this.config.dataDir}`)
  }

  /** subagent/end 观察钩子（T-021 起写节点状态；当前仅调试日志 + 清理态守卫）。 */
  onSubagentEnd(payload: unknown): void {
    if (this._disposed) return
    this.ctx.logger.debug('[visual-workflow] subagent/end observed: %o', payload)
    // TODO(T-021)：解析 payload 子代理归属，回写 run 节点状态（ok/fail + output）。
  }

  /** agent/error 观察钩子（T-021 起触发父代理出错快速终止；当前仅调试日志）。 */
  onAgentError(payload: unknown): void {
    if (this._disposed) return
    this.ctx.logger.debug('[visual-workflow] agent/error observed: %o', payload)
    // TODO(T-021)：匹配当前 run 的父代理 → 标记失败并释放运行锁。
  }

  /**
   * 清理运行时资源（幂等）。
   * 为什么显式提供（架构文档 §9.6）：fiber 卸载时需尽力中止全部运行、中断
   * in-flight 子代理、停止看护定时器；当前阶段这些资源尚未建立（T-021/T-031），
   * 本方法先固化幂等骨架，后续装配任务向其中追加真实清理。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    // TODO(T-021)：中止全部 run（abort controller + 中断 in-flight 子代理）。
    // TODO(T-031)：尽力停止模式二服务进程（不等待退出码）。
    this.ctx.logger.info('[visual-workflow] host disposed')
  }
}

// ── 插件入口 ────────────────────────────────────────────────────────────

/** 插件 apply 入口：实例化并注册 visualWorkflowHost service（随 fiber 自动注销）。 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(VisualWorkflowHost, config)
}
