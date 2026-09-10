// src/client/sidebar/session-root.ts
//
// 官方 sessions 服务的读取缝（纯函数，零官方包依赖）：当前选中会话 + 会话树根。
//
// 为什么需要「会话树根」：DSH 中每个子代理对话持有独立 childSessionId
// （官方 dsh-subagent：childId = SessionId(randomUUID())，header.parentSession 记录父链）。
// 若工作台直接绑定「当前选中会话」，在子代理对话界面打开时实例列表会按子代理会话过滤为空，
// 实例被误认为「跟随代理 ID」。因此实例/服务按**会话树根**隔离：沿官方
// sessions.list 快照的父链字段上溯到无父（根）会话，主代理与其全部后代子代理共享同一实例列表。
//
// 【0.1.5-rc.1 字段取证】客户端投影层（dsh-api-session-controller/client/sessions）
// 的 SessionSummary 父链字段名为 **parentId**（client/service.d.ts:39），而 0.1.2 时代
// 曾被写作 parentSessionId —— 故双读兼容：优先 parentId、回退 parentSessionId。
// 快照缺 byId（旧运行时/非浏览器环境）时回退当前会话自身（行为不变，单代理场景无回归）。

/** 官方 sessions.list 快照的最小形状（运行时守卫后收窄）。 */
export interface SessionsSnapshotLike {
  /** 当前选中会话 id。 */
  current?: unknown
  /** 会话 id → 摘要（含父链字段）。 */
  byId?: Record<string, unknown>
}

/** 官方 sessions 服务的最小形状（快照读 + 订阅；双版本读法）。 */
export interface SessionsServiceLike {
  list?: {
    getSnapshot?(): SessionsSnapshotLike | undefined
    get?(): SessionsSnapshotLike | undefined
    subscribe?(fn: () => void): () => void
  } | null
}

/** 取当前快照（0.1.5 用 getSnapshot；旧运行时可回退 get）。 */
function snapshotOf(sessions: SessionsServiceLike | null | undefined): SessionsSnapshotLike | undefined {
  const list = sessions?.list
  if (!list) return undefined
  if (typeof list.getSnapshot === 'function') return list.getSnapshot()
  if (typeof list.get === 'function') return list.get()
  return undefined
}

/**
 * 解析当前选中会话 id（无会话返回空串）。
 * @param ctx - 取服务的最小上下文（`get(name)`）。
 * @returns 当前会话 id，或空串。
 */
export function currentSessionOf(ctx: { get?(name: string): unknown }): string {
  const sessions = ctx.get?.('sessions') as SessionsServiceLike | null | undefined
  const current = snapshotOf(sessions)?.current
  return typeof current === 'string' ? current : ''
}

/**
 * 沿父链上溯到会话树根（无父/父不在快照中即返回自身；带环检测）。
 * @param current - 当前选中会话 id。
 * @param sessions - 官方 sessions 服务（可空）。
 * @returns 会话树根 id；current 为空时返回空串。
 */
export function rootSessionIdOf(
  current: string,
  sessions: SessionsServiceLike | null | undefined,
): string {
  if (!current) return ''
  const snapshot = snapshotOf(sessions)
  if (!snapshot?.byId) return current
  let cursor = current
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const entry = snapshot.byId[cursor] as { parentId?: unknown; parentSessionId?: unknown } | undefined
    // 双读：0.1.5 client 侧字段为 parentId；旧版本曾用 parentSessionId。
    const rawParent = entry?.parentId ?? entry?.parentSessionId
    const parent = typeof rawParent === 'string' ? rawParent : ''
    if (!parent || !snapshot.byId[parent]) return cursor
    cursor = parent
  }
  return cursor
}
