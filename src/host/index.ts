// DSH Visual Workflow —— Host 半区插件入口。
//
// T-002：可被 Cordis Loader 加载的最小宿主入口骨架。导出 name/inject/apply，
// 并提供一个 `visualWorkflowHost` Service 占位（apply 内实例化 Service 子类完成
// 注册，Service 构造器内部 reflect.provide + 随 fiber 自动注销）。真实装配
// （agents/storage/orchestrator 注入、wf_* 工具注册、
// HTTP API 路由、watchdog、subagent-end 观察、dispose 清理）由 T-015 完成，
// 本文件仅保留 init 日志与 dispose 清理骨架 + TODO 标记装配点。
//
// 取证结论（详见报告）：
//   - z 来自 @deepseek-ai/schemastery（默认导出 `import z from ...`，非 zod），
//     官方 packages/host/webserver/src/index.ts L16 与 packages/fs/tool-fs/src/index.ts L9
//     均如此导入；故 schemastery 进入 peerDependencies（共享运行时，SKILL §3.2）。
//   - Service 基类 / Service.init 符号 / Context 均从 @deepseek-ai/cordis 导入
//     （官方 webserver L15、L73、L88、L163）。
//   - 旧项目 lib/index.js 以 `ctx.provide("visualWorkflowHost", host)` 提供宿主；
//     本实现改用官方 Service 子类（名称仍为 visualWorkflowHost，语义一致且随 fiber 自动注销）。

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

// 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。
export const name = 'dsh-visual-workflow'

// 必需 service 声明（W-05：所有 @deepseek-ai/* 服务经 ctx.get() 运行时解析）。
// T-002 阶段为最小骨架：宿主本身无强依赖官方 service，故 inject 为空数组；
// T-015 装配时若确定必需依赖（如 tools/agents/subagents/webServer），将在此补齐，
// 未满足时 fiber 保持 pending，框架就绪后自动激活。
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

// ── visualWorkflowHost Service 占位 ───────────────────────────────────────
// 提供 `visualWorkflowHost` 稳定 service；T-015 将在此注入真实状态（FlowStore、
// 运行锁/快照、节点子代理表等），并挂载 agents/subagents/webServer 等依赖。

/** 提供给 ctx 的宿主 service 名称。 */
export const VisualWorkflowHostServiceName = 'visualWorkflowHost'

/** 宿主 service 占位：当前仅持有 ctx 与解析后的 config，装配逻辑留待 T-015。 */
export class VisualWorkflowHost extends Service {
  /** config 由 Service 构造带出（super 注册即持有 config 引用）。 */
  constructor(
    ctx: Context,
    public readonly config: Config,
  ) {
    super(ctx, VisualWorkflowHostServiceName)
  }

  /** 启动日志（Service.init 语义：初始化失败应让 fiber 失败，此处不吞错）。 */
  async [Service.init](): Promise<void> {
    this.ctx.logger.info(
      `[visual-workflow] host service ready at ${this.config.dataDir}`,
    )
    // TODO(T-015)：装配真实运行时——FlowStore 初始化、运行锁/快照表、节点子代理表。
    //   此处仅打印 dataDir 表明骨架可加载；目录创建等副作用延后到 T-012/T-015。
    // TODO(T-015)：挂载可选依赖 ctx.inject(['agents','subagents','webServer'...])。
  }
}

// ── 插件入口 ────────────────────────────────────────────────────────────

/** 插件 apply 入口：实例化并注册 visualWorkflowHost service，安装 dispose 清理骨架。 */
export function apply(ctx: Context, config: Config): void {
  // 实例化 Service 子类即注册（Service 构造器内部 reflect.provide + 随 fiber 注销）。
  ctx.plugin(VisualWorkflowHost, config)

  // dispose 清理骨架：ctx.effect 返回的 disposer 在 fiber 卸载时执行（cordis 4.x
  // 内置 Events 无 dispose 事件，清理归 fiber effect 所有权——SKILL §4.3）。
  // T-015 在此中止全部运行、中断 in-flight 子代理、停止看护与服务进程（架构文档 §9.6）。
  ctx.effect(() => () => {
    // TODO(T-015)：disposeRuns / 中断节点子代理 / 停止空闲看护 / 尽力停止服务进程。
  }, 'visualWorkflowHost.dispose')
}

// TODO(T-015)：apply 内补齐以下装配点（本任务不实现）：
//   - ctx.inject(['agents','subagents'], ...) 绑定子代理能力（可选动态依赖）。
//   - ctx.tools.register(...) 注册 wf_run_node / wf_finish / wf_ask / wf_ask_agent / wf_db_query。
//   - ctx.effect(() => ctx.webServer.register(...)) 挂载 /visual-workflow GUI API。
//   - ctx.on('subagent/end') 观察节点状态回写；ctx.on('agent/error') 快速终止。
