import { AsyncLocalStorage } from "node:async_hooks"
import { CHILD_AGENT_HIDDEN_TOOLS, RESERVED_TRANSPORT_TOOL, TEAM_TOOL_NAMES } from "../shared/protocol.js"

interface ToolExecution {
  name: string
}

interface ScopedTools {
  get(name: string, scope?: unknown): unknown
  restrict(filter: { allow?: string[]; deny?: string[] }): () => void
  guard(check: (execution: ToolExecution) => string | undefined): () => void
}

export class ChildToolPermissionError extends Error {
  readonly code = "WF_CHILD_TOOL_POLICY_FAILED"
  readonly phase = "tool_policy"
  readonly retryable = false
}

export interface ChildToolFilterSetup {
  contribution(childCtx: unknown, scope?: unknown): () => void
  withPending<T>(allow: readonly string[] | undefined, operation: () => Promise<T>): Promise<T>
  remember(childId: string, allow: readonly string[] | undefined): void
  restore(childId: string, childCtx: unknown, scope?: unknown, denyAll?: boolean): () => void
  peekPending?(): readonly string[] | undefined
}

function toolsOf(raw: unknown): ScopedTools {
  const context = raw as { get?: (name: string) => unknown } | null
  const tools = context?.get?.("tools") as Partial<ScopedTools> | undefined
  if (!tools || typeof tools.get !== "function" || typeof tools.restrict !== "function" || typeof tools.guard !== "function") {
    throw new ChildToolPermissionError("子代理缺少工具权限接口（get/restrict/guard）；无法安全启动")
  }
  return tools as ScopedTools
}

/** 在实际创建作用域中验证继承权限；自己的工具由执行守卫约束。 */
export function installChildToolPolicy(raw: unknown, allow: readonly string[] | undefined, scope?: unknown, denyAll = false): () => void {
  const tools = toolsOf(raw)
  const approved = allow === undefined ? undefined : new Set(allow)
  const hidden: readonly string[] = CHILD_AGENT_HIDDEN_TOOLS
  const infrastructure: readonly string[] = [RESERVED_TRANSPORT_TOOL, ...TEAM_TOOL_NAMES]
  // 创建监听器必须等待策略成功，失败向上抛出，不能发布或派发未装配的 child。
  const disposeGuard = tools.guard(({ name }) => {
    if (denyAll) return "WF_DAG_REVIEW_TOOL_DENIED: 语义验收不授予工具执行权限"
    if (typeof name !== 'string') return 'WF_CHILD_TOOL_DENIED: 无法识别工具执行名称'
    if (hidden.includes(name)) return "WF_NOT_ROOT: 父代理专属工具禁止子代理调用"
    if (approved !== undefined && !approved.has(name) && !infrastructure.includes(name)) {
      return "WF_CHILD_TOOL_DENIED: 工具未获该节点授权"
    }
    return undefined
  })
  const disposers = [disposeGuard]
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const release of disposers.reverse()) {
      try { release() } catch { /* 继续释放其他独立贡献 */ }
    }
  }
  try {
    if (approved !== undefined) {
      const visible = [...approved].filter((name) => !hidden.includes(name) && !infrastructure.includes(name))
      const candidates = visible.filter((name) => {
        if (tools.get(name, scope)) return true
        if (name === "subagent") return false
        throw new ChildToolPermissionError(`节点工具在实际子代理作用域不可用：${name}`)
      })
      // 公开 restrict([]) 只移除继承面；同一个 agent key 下仍可见的工具属于自身面。
      // 不读取私有 registry，也不根据异常文案判断工具类型。
      const releaseProbe = tools.restrict({ allow: [] })
      let inherited: string[]
      try { inherited = candidates.filter((name) => !tools.get(name, scope)) } finally { releaseProbe() }
      disposers.push(tools.restrict({ allow: inherited }))
    }
    return dispose
  } catch (error) {
    dispose()
    if (error instanceof ChildToolPermissionError) throw error
    throw new ChildToolPermissionError("子代理工具白名单安装失败；创建已中止，请检查当前 Scope 的 get/restrict/guard 契约")
  }
}

export function createChildToolFilterSetup(): ChildToolFilterSetup {
  const pending = new AsyncLocalStorage<readonly string[] | undefined>()
  const remembered = new Map<string, readonly string[]>()
  return {
    contribution: (context, scope) => installChildToolPolicy(context, pending.getStore(), scope),
    withPending: (allow, operation) => pending.run(allow, operation),
    peekPending: () => pending.getStore(),
    remember: (id, allow) => {
      if (allow === undefined) remembered.delete(id)
      else remembered.set(id, [...allow])
    },
    restore: (id, context, scope, denyAll) => installChildToolPolicy(context, remembered.get(id), scope, denyAll),
  }
}
