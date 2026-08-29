// src/host/config.ts
//
// 插件契约声明：稳定标识名（name/inject）与 Host 全部可配置键
// （Config 接口 + schemastery schema；默认值与 cordis.patch.yml 逐字一致）。
// 纯配置声明，不含运行时装配。

import z from '@deepseek-ai/schemastery'

/** 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。 */
export const name = 'dsh-visual-workflow'

// 必需 service 声明为空：宿主插件不声明强依赖官方 service——数据层自持，
// 事件经 ctx.on 订阅，任何缺失的官方能力都在 Service.init 内运行时解析。
export const inject: string[] = []

// ── Config schema ────────────────────────────────────────────────────────
// 与 cordis.patch.yml 的 13 个配置键一一对应，默认值逐字一致。默认值收敛在
// schema：任何部署可能需要改变的值都应成为配置而非源码常量。

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

/** 导出的 Config schema，供 Loader 校验与默认值填充。 */
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
