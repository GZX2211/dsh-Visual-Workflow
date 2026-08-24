// src/host/service-runner.ts
//
// 模式二服务进程入口插件（package.json exports["./service-runner"]）。
// 由服务管理器 fork：`dsh --profile headless --patch <serve.patch.yml>
// --visual-workflow-serve <serviceId> --port <n>`。
//
// 装配：解析 cmdlineArgs（权威，flag 覆盖 config）→ 挂载主插件
// VisualWorkflowHost（复用编排/存储/工具全量能力，跳过磁盘对账——服务进程
// 不接管主进程的运行记录）→ 等服务树稳定 → 按 serviceId 加载服务工作流 →
// SessionMap（userId→sessionId）+ OpenAI 兼容 API 注册。
//
// 退出协调：失败写 stderr 并 appExit(1)；正常生命周期由主进程 SIGTERM 驱动
// （launcher 的 bounded shutdown 会 dispose 整棵树）。

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { VisualWorkflowHost } from './index.js'
import { SessionMap } from './service/sessions-map.js'
import { OpenAiApi, registerOpenAiApi } from './service/openai-api.js'
import { sweepWatchdogOnce } from './orchestrator/watchdog.js'
import type { FlowStore } from './storage/flow-store.js'

/** 稳定插件名（serve.patch.yml 的 insert 行 name 解析目标）。 */
export const name = 'visual-workflow-service'

/** 核心服务：cmdlineArgs 由 launcher 在树挂载前提供（app 自持参数族）。 */
export const inject = ['cmdlineArgs']

/** 插件配置（serve.patch.yml 渲染写入；cmdlineArgs 为权威覆盖源）。 */
export interface Config {
  /** 服务 id（编排 flowId 与映射文件作用域）。 */
  serviceId: string
  /** 数据根目录（与主进程共享磁盘数据层）。 */
  dataDir: string
  /** 监听端口。 */
  port: number
  /** 鉴权密钥（null 关闭）。 */
  apiKey: string | null
  /** 单服务并发请求上限。 */
  maxConcurrent: number
}

export const Config: z<Config> = z.object({
  serviceId: z.string().required(),
  dataDir: z.string().required(),
  port: z.natural().required(),
  apiKey: z.union([z.string(), z.const(null)]).default(null),
  maxConcurrent: z.natural().default(50),
})

/** 进程 IO 缝（测试可替换）。 */
interface RunnerIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  exit(code: number): void
}

/** 测试可见的进程流替换点。 */
export const internals: { stdout: RunnerIo['stdout']; stderr: RunnerIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** 解析内层参数族：--visual-workflow-serve <serviceId> --port <n>。 */
export function parseServiceArgs(args: readonly unknown[]): { serviceId: string; port: number } | null {
  let serviceId = ''
  let port = Number.NaN
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] ?? '')
    if (token === '--visual-workflow-serve' && index + 1 < args.length) {
      serviceId = String(args[index + 1] ?? '').trim()
    } else if (token === '--port' && index + 1 < args.length) {
      port = Number(args[index + 1])
    }
  }
  if (!serviceId || !Number.isInteger(port) || port <= 0) return null
  return { serviceId, port }
}

/** 启动失败报告（stderr + 失败退出码）。 */
function fail(io: RunnerIo, error: unknown): void {
  io.stderr.write(`dsh: visual-workflow-service: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * 服务进程装配（异步；失败经 fail 统一收口）。
 */
async function boot(ctx: Context, config: Config, io: RunnerIo): Promise<void> {
  // cmdlineArgs 权威解析（launcher 转交的 app 参数族；缺失时回退 config）。
  // ctx.cmdlineArgs 为注入服务（类型经运行时守卫，避免官方类型依赖）。
  const cmdline = (ctx as unknown as { cmdlineArgs?: { get?(): unknown[] } }).cmdlineArgs
  const parsed = parseServiceArgs(cmdline?.get?.() ?? [])
  const serviceId = parsed?.serviceId ?? config.serviceId
  const port = parsed?.port ?? config.port
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(serviceId)) throw new Error(`非法 serviceId：${serviceId}`)
  if (!Number.isInteger(port) || port <= 0) throw new Error(`非法端口：${port}`)

  // 主插件全量装配（编排/存储/工具/看护）；skipReconcile：磁盘对账属主进程职责。
  // Service 构造即注册（Cordis 语义），函数 plugin 形式仅承载构造选项。
  ctx.plugin((innerCtx) => {
    new VisualWorkflowHost(innerCtx, {
      dataDir: config.dataDir,
      servicePortBase: config.port,
      apiKey: config.apiKey,
      maxConcurrentPerService: config.maxConcurrent,
      wfAskAgentTimeoutMs: 120000,
      runIdleTimeoutMs: 1800000,
      runPollMs: 2000,
      reactIterationLimitDefault: 50,
      retryLimitDefault: 3,
      outputFullLimit: 102400,
      documentTextLimit: 20000,
      embeddingModelDir: null,
      embeddingEndpoint: null,
    }, { skipReconcile: true })
  })

  // Loader 兄弟行并发挂载：等待整树稳定后再读服务/建会话（headless 同款时序）
  await ctx.get('loader')?.await()

  const host = ctx.get('visualWorkflowHost') as VisualWorkflowHost | undefined
  if (!host) throw new Error('visualWorkflowHost 服务未激活')
  const service = await host.store.getServiceById(serviceId)
  if (!service) throw new Error(`服务不存在：${serviceId}`)

  const sessions = new SessionMap({ store: host.store, serviceId })
  const api = new OpenAiApi({
    store: host.store,
    orchestrator: host.orchestrator,
    serviceId,
    apiKey: config.apiKey,
    maxConcurrent: config.maxConcurrent,
    resolveSession: (userId) => sessions.resolve(userId),
    ensureRootAgent: (sessionId) => ensureRootAgent(ctx, host.store, serviceId, sessionId),
    sweep: () => sweepWatchdogOnce(host.orchestrator),
    logger: { warn: (message) => ctx.logger.warn(message) },
  })
  ctx.effect(() => registerOpenAiApi(ctx, api), 'visualWorkflowService.openai')

  io.stdout.write(`visual-workflow-service: ${serviceId} listening on port ${port} (maxConcurrent=${config.maxConcurrent})\n`)
}

/** 按会话取/建根 Agent（父代理节点 provider/model 优先；会话持久化上下文保留）。 */
async function ensureRootAgent(
  ctx: Context,
  store: FlowStore,
  serviceId: string,
  sessionId: string,
): Promise<{ agent: unknown; provider?: string; model?: string }> {
  const agents = ctx.get('agents') as {
    get?(id: string): unknown
    create?(options: Record<string, unknown>): Promise<{ agent?: unknown } | unknown>
  } | null
  if (!agents || typeof agents.get !== 'function' || typeof agents.create !== 'function') {
    throw new Error('agents 服务不可用，无法建立服务会话')
  }
  const service = await store.getServiceById(serviceId)
  const parent = service?.nodes?.find((node) => node.kind === 'parent')
  const data = (parent as { data?: Record<string, unknown> } | undefined)?.data
  const provider = typeof data?.provider === 'string' && data.provider ? data.provider : undefined
  const model = typeof data?.model === 'string' && data.model ? data.model : undefined

  let agent = agents.get(sessionId)
  if (!agent) {
    const created = await agents.create({
      sessionId,
      meta: { cwd: process.cwd() },
      ...(provider && model ? { agentOptions: { provider, model } } : {}),
    })
    agent = (created as { agent?: unknown })?.agent ?? created
  }
  if (agent === null || agent === undefined) throw new Error('服务会话 Agent 建立失败')
  return { agent, provider, model }
}

/**
 * 插件入口：启动异步装配（不阻塞树挂载）。
 * appExit 由 launcher 提供（缺失报错——服务进程必须能请求退出）。
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (typeof exit !== 'function') {
    throw new Error('visual-workflow-service: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: RunnerIo = { stdout: internals.stdout, stderr: internals.stderr, exit: exit as (code: number) => void }
  void boot(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
