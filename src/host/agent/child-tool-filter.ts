// src/host/agent/child-tool-filter.ts
//
// 子代理工具白名单装配（allow 侧）与创建窗口夹持。
//
// 与 runner 的既有路径的关系：
//   - 普通节点子代理由宿主在 `agent/created` 创建窗口内自行安装 restrict（0.2.1+ 的
//     startActivation 请求已不接受 toolFilter；≤0.2.0 旧宿主仍经 startContinuable 传
//     toolFilter，与本装配双保险）；
//   - Team 成员由官方 Team 服务建立，该服务的创建请求**不接受** toolFilter，
//     因此白名单必须由宿主在 `agent/created` 创建窗口内自行安装（官方语义等价：
//     restrict 是作用域级声明式掩码，安装即对该子代理生效）。
//
// 名单来源与约束：
//   - 名单由 resolveAgentTools 解析（已剔除永不进子代理的工具、官方保留传输名与
//     官方 Team 工具名——后两者进入 restrict 名单会被官方「未知全局工具」校验拒绝）；
//   - 空名单不安装 restrict（与官方路径一致：空表示不限制继承面）；
//   - restrict 抛错按「尽力而为」处理：不阻断子代理创建，工具可见性退回继承面，
//     并保留 childVisibilityContribution 的 deny 双保险。

import { AsyncLocalStorage } from 'node:async_hooks'

/** 工具服务最小结构（restrict 只接受可限制的全局工具名）。 */
interface ToolsServiceLike {
  restrict?(filter: { allow?: string[]; deny?: string[] }): () => void
}

/** 子代理工具白名单装配（贡献 + 创建窗口夹持 + 按 childId 留存）。 */
export interface ChildToolFilterSetup {
  /** 贡献（每子代理创建窗口内由宿主调用；读创建窗口内的白名单并安装 restrict）。 */
  contribution(childCtx: unknown): () => void
  /**
   * 在创建窗口内夹住本次子代理的工具白名单。
   * 为什么需要：白名单无法经官方 Team 服务的创建请求传递，只能由本装配在窗口内取得。
   */
  withPending<T>(allow: readonly string[] | undefined, operation: () => Promise<T>): Promise<T>
  /**
   * 按 childId 留存白名单，供重发布（冷恢复）时重装。
   * 为什么需要：子代理销毁重发布后是新作用域，创建窗口内安装的 restrict 随之消失。
   */
  remember(childId: string, allow: readonly string[] | undefined): void
  /**
   * 重发布时按 childId 重装白名单；返回该次安装的撤销函数（无记录时返回空函数）。
   */
  restore(childId: string, childCtx: unknown): () => void
}

/**
 * 创建子代理工具白名单装配。
 * WeakMap/ALS 之外只持有 childId → 名单的留存表；条目为工具名数组，随宿主持有的
 * 本装配对象一起回收（宿主 dispose 后无引用）。
 */
export function createChildToolFilterSetup(): ChildToolFilterSetup {
  const pending = new AsyncLocalStorage<readonly string[] | undefined>()
  /** childId → 已留存的工具白名单（重发布重装用）。 */
  const remembered = new Map<string, readonly string[]>()

  const apply = (rawChildCtx: unknown, allow: readonly string[] | undefined): () => void => {
    if (!allow || allow.length === 0) return () => {}
    try {
      if (rawChildCtx === null || typeof rawChildCtx !== 'object') return () => {}
      const childCtx = rawChildCtx as { get?: (name: string) => unknown }
      if (typeof childCtx.get !== 'function') return () => {}
      const tools = childCtx.get('tools') as ToolsServiceLike | null | undefined
      if (!tools || typeof tools.restrict !== 'function') return () => {}
      return tools.restrict({ allow: [...allow] })
    } catch {
      // 官方校验拒绝（未注册名等）或服务缺失：不阻断创建，可见性退回继承面
      return () => {}
    }
  }

  const contribution = (rawChildCtx: unknown): (() => void) => apply(rawChildCtx, pending.getStore())

  const withPending = <T>(allow: readonly string[] | undefined, operation: () => Promise<T>): Promise<T> =>
    pending.run(allow, operation)

  const remember = (childId: string, allow: readonly string[] | undefined): void => {
    const id = String(childId ?? '')
    if (!id) return
    if (!allow || allow.length === 0) {
      remembered.delete(id)
      return
    }
    remembered.set(id, [...allow])
  }

  const restore = (childId: string, childCtx: unknown): (() => void) => {
    const allow = remembered.get(String(childId ?? ''))
    if (!allow) return () => {}
    return apply(childCtx, allow)
  }

  return { contribution, withPending, remember, restore }
}
