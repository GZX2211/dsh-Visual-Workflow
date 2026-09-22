// src/host/sessions/session-provider.ts
//
// 官方会话 / Agent 服务的运行时能力适配（零官方包类型依赖，全部经运行时守卫）：
//   - 创建新会话 + 根 Agent（ctx.agents.create + agentPresets.resolve/mount）；
//   - 解析某会话记录的工作目录（ctx.sessions 的两代读法）；
//   - 新会话工作目录决策（显式路径优先，否则继承创建者会话 cwd）。
//
// 为什么独立于 scheduler / service：这三项能力被多个域共同消费——定时任务触发
// （scheduler）、模式二服务进程的新会话请求（service）、GUI「开启新会话」端点
// （remote）——放在任一业务域内都会造成其它域反向依赖该业务域。本模块只做
// 「官方服务 → 本插件语义」的适配与决策，不拥有任何业务状态。
//
// 非侵入扩展（架构文档 §1）：经 ctx.get('agents') / ctx.get('agentPresets') /
// ctx.get('sessions') 解析能力；创建失败抛明确错误，由调用方按各自的失败语义处理
// （定时任务=触发失败不补打；服务请求=500；GUI 端点=HTTP 错误）。

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/** agents 服务「创建」能力的最小结构（运行时守卫后收窄）。 */
interface AgentsCreateLike {
  create?(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string }
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: unknown) => Promise<unknown> | void
  }): Promise<{ agent: { id: unknown } }>
}

/** agentPresets 服务「解析 + 挂载」能力的最小结构（运行时守卫后收窄）。 */
interface AgentPresetsLike {
  resolve?(id?: string): Promise<{ id: string }>
  mount?(agentCtx: unknown, id?: string): Promise<unknown>
}

/** 新会话创建缝（调用方依赖；单测 fake）。 */
export interface SessionProvider {
  /**
   * 创建新会话（含根 Agent）并返回会话 id。
   * @param options.label 会话来源标识（写入用途说明；元信息可追溯）
   * @param options.agentPreset 官方预设 id（缺省 standard：父代理具备官方标准工具集）
   * @param options.cwd 可选工作目录（继承创建者会话；解析不到时省略）
   */
  createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string>
}

/** Cordis 实现：经 ctx.agents.create 创建会话与根 Agent（工厂缺失时抛出明确错误）。 */
export class CordisSessionProvider implements SessionProvider {
  constructor(private readonly ctx: Context) {}

  async createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string> {
    const agents = this.ctx.get('agents') as AgentsCreateLike | null | undefined
    if (!agents || typeof agents.create !== 'function') {
      throw new Error('agents 服务不支持创建会话（agent 工厂未安装），无法执行「新会话」模式')
    }
    // 预设装配：agentPreset 不只写入会话 header，还必须在创建 setup 里把所属 preset
    // 挂载到该 Agent 的作用域（官方 api-proxy composeAgent 同源：先 resolve 得 resolved id
    // 供 header 记录，再在 setup 内 agentPresets.mount，使官方工具/prompt 段对 agent 可见）。
    // 只写 header 不 mount 会让新会话的根 Agent 仅继承全局层（宿主 + 插件 wf_* + MCP）工具，
    // 官方 standard 预设的工具（bash/pwsh/fs/jobs/skill/goal/subagent/workflow/web…）全部缺失。
    //
    // 关键约定：setup 必须「await 挂载但【不返回】mount 的结果」。官方 agent 工厂在
    // setup 完成后会对返回值调用 `.commit()`（dsh-agent-loop setupAndPublish：
    // `(await setup?.(agent.ctx))?.commit()`）。agentPresets.mount 返回的是被组装
    // 的 preset 对象（无 `.commit` 方法），若把它作为 setup 返回值，触发时会在
    // `.commit()` 处抛出 `(intermediate value).commit is not a function`，导致
    // 新会话创建失败。与官方 composeAgent 保持一致：仅执行挂载副作用，
    // 返回 void（`.commit()` 对空值安全短路；preset 子树随 agent fiber 自动卸载）。
    const presetId = options.agentPreset ?? 'standard'
    const agentPresets = this.ctx.get('agentPresets') as AgentPresetsLike | null | undefined
    if (agentPresets && typeof agentPresets.resolve === 'function' && typeof agentPresets.mount === 'function') {
      const resolvedPresetId = (await agentPresets.resolve(presetId)).id
      const mountPreset = async (agentCtx: unknown): Promise<void> => {
        await agentPresets.mount!(agentCtx, resolvedPresetId)
      }
      const sessionId = `sched-${randomUUID().replace(/-/g, '').slice(0, 16)}`
      await agents.create({
        sessionId,
        meta: {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          agentPreset: resolvedPresetId,
        },
        setup: mountPreset,
      })
      return sessionId
    }
    const sessionId = `sched-${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await agents.create({
      sessionId,
      meta: {
        ...(options.cwd ? { cwd: options.cwd } : {}),
      },
    })
    return sessionId
  }
}

/** sessions 服务的两种形态（运行时守卫后收窄；零官方类型依赖）。 */
interface SessionsServiceLike {
  /** 0.1.5-rc.1 形态：SessionStore.get(SessionId) → Session | undefined（Session.header 为 SessionHeader）。 */
  get?(id: string): { header?: { cwd?: unknown } } | undefined
  /**
   * ≤0.1.2 形态：客户端式快照 store（host 侧是否曾存在未知，保留为兜底）。
   * 注意 0.1.5-rc.1 的 `list` 是**方法**（返回 Session[]），取其 .getSnapshot 恒为
   * undefined —— 故这条路径在新宿主上自然失效而不抛错。
   */
  list?: {
    getSnapshot?(): { byId?: Record<string, unknown> }
    get?(): { byId?: Record<string, unknown> }
  }
}

/** 0.1.5-rc.1 读法：SessionStore.get(id)?.header?.cwd（Session.header 为 SessionHeader）。 */
function readCwdFromSessionStore(
  sessions: SessionsServiceLike | null | undefined,
  sessionId: string,
): unknown {
  const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
  return session?.header?.cwd
}

/** ≤0.1.2 兜底读法：快照 store 的 byId[id]（meta.cwd / header.meta.cwd）。 */
function readCwdFromSnapshot(
  sessions: SessionsServiceLike | null | undefined,
  sessionId: string,
): unknown {
  const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.()
  const entry = (snapshot?.byId ?? {})[sessionId] as
    | { meta?: { cwd?: unknown }; header?: { meta?: { cwd?: unknown } } }
    | undefined
  return entry?.meta?.cwd ?? entry?.header?.meta?.cwd
}

/**
 * 解析某会话记录的工作目录（新会话继承创建者 cwd 用；读不到返回 undefined，
 * 由调用方组装时省略该字段——官方 meta.cwd 为可选）。
 *
 * 【0.1.5-rc.1 适配】host 侧 `ctx.sessions` 是 SessionStore：`list()` 是**方法**
 * （返回 Session[]），**不存在** list.getSnapshot() / list.get() / byId / current /
 * subscribe（取证：dsh-session/lib/types/index.d.ts 的 SessionStore.get/list）。
 * 旧实现只走快照读法，在新宿主上恒返回 undefined，导致「新会话」模式
 * 静默丢失 cwd 继承。正确读法：`sessions.get(id)?.header?.cwd`。
 * 快照读法保留为兜底（旧宿主容忍）；两条路径都只是运行时守卫读取，无副作用。
 * @param ctx - 取服务的最小上下文（`get(name)`）。
 * @returns 按会话 id 解析 cwd 的异步函数（任何异常都降级为 undefined）。
 */
export function sessionCwdResolver(ctx: { get(name: string): unknown }): (sessionId: string) => Promise<string | undefined> {
  return async (sessionId: string): Promise<string | undefined> => {
    try {
      const sessions = ctx.get('sessions') as SessionsServiceLike | null | undefined
      const cwd = readCwdFromSessionStore(sessions, sessionId) ?? readCwdFromSnapshot(sessions, sessionId)
      return typeof cwd === 'string' && cwd.trim() ? cwd : undefined
    } catch {
      return undefined
    }
  }
}

/** 新会话工作目录决策输入。 */
export interface NewSessionCwdInput {
  /**
   * 显式工作区路径（绝对目录）。
   * 不变式：**存在性校验由接受该配置的保存端点负责**（工作流实例创建、定时任务保存、
   * 服务文档保存，见 `./workspace-path.ts` 的 `resolveWorkspacePath`）；
   * 运行期创建会话不重复读盘校验——避免每次触发/每请求额外一次文件 IO，
   * 且路径失效属运行期失败（按调用方各自的失败语义处理）。
   */
  workspacePath?: string | null
  /** 创建者会话 id（继承 cwd 的来源；缺失则该路省略）。 */
  creatorSessionId?: string | null
  /** 会话 cwd 解析能力（宿主注入；缺失时省略继承）。 */
  sessionCwdOf?: (sessionId: string) => Promise<string | undefined>
}

/**
 * 解析新会话的工作目录（**唯一实现**，禁止在调用方另行复制该决策）：
 *   - 显式 workspacePath 非空 → 采用该路径（不继承创建者）；
 *   - 否则继承创建者会话 cwd（解析失败/读不到 → 省略，用官方默认工作区）；
 *   - 都没有 → undefined（调用方省略 cwd 字段）。
 *
 * 只做「选择」不做「校验」：校验责任在保存端点（见 NewSessionCwdInput.workspacePath）。
 */
export async function resolveNewSessionCwd(input: NewSessionCwdInput): Promise<string | undefined> {
  const explicit = String(input.workspacePath ?? '').trim()
  if (explicit) return explicit
  if (input.creatorSessionId && input.sessionCwdOf) {
    return await input.sessionCwdOf(input.creatorSessionId).catch(() => undefined)
  }
  return undefined
}
