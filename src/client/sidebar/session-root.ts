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
// 【0.1.5-rc.1 → 0.1.6 适配】官方 commit 6830e1460d（refactor(session-controller):
// own Client Session generations）把 SessionListState 的 **current / currentAddress
// 字段移除**（"navigation belongs to view owners"）——快照只剩 ids/byId/phase/
// subagentsByParent/jobsBySession。官方 ui-session 的 publishMain 由此改为**派生**：
// 主视图当前会话 = byId 中 retainedBy.mainView 引用计数 > 0 的会话（SessionSummary
// 新增 retainedBy 字段，取证 dsh-api-session-controller/src/client/sessions/service.ts
// 的 publishMain）。本缝同款双读：优先 0.1.5 的 snapshot.current，回退 0.1.6 的
// mainView 派生（ids 顺序遍历，与官方 Object.values(byId) 首个命中语义一致）。
// 快照缺 byId（旧运行时/非浏览器环境）时回退空串（行为不变，单代理场景无回归）。

/** 官方 sessions.list 快照的最小形状（运行时守卫后收窄）。 */
export interface SessionsSnapshotLike {
  /** 当前选中会话 id（0.1.5-rc.1 及以前；0.1.6 起已移除，仅作旧运行时优先读法）。 */
  current?: unknown
  /** 会话 id → 摘要（含父链字段；0.1.6 起含 retainedBy 引用计数）。 */
  byId?: Record<string, unknown>
  /** Host 列表顺序（0.1.6 起存在；缺省时按 byId 键序遍历）。 */
  ids?: unknown
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
 * 0.1.6 主视图当前会话派生：byId 中 retainedBy.mainView 计数 > 0 的首个会话
 * （ids 顺序优先，缺省按 byId 键序——与官方 ui-session publishMain 的首个命中
 * 语义一致）。无主视图保留（空态/无会话打开）返回空串。
 */
function mainViewSessionOf(snapshot: SessionsSnapshotLike | undefined): string {
  if (!snapshot?.byId) return ''
  const order = Array.isArray(snapshot.ids)
    ? (snapshot.ids as unknown[])
    : Object.keys(snapshot.byId)
  for (const id of order) {
    if (typeof id !== 'string') continue
    const row = snapshot.byId[id] as { retainedBy?: Record<string, unknown> } | undefined
    const count = Number(row?.retainedBy?.mainView ?? 0)
    if (Number.isFinite(count) && count > 0) return id
  }
  return ''
}

/**
 * 解析当前选中会话 id（无会话返回空串）。
 * 双读兼容：0.1.5 读 snapshot.current；0.1.6（current 已移除）按 retainedBy.mainView 派生。
 * @param ctx - 取服务的最小上下文（`get(name)`）。
 * @returns 当前会话 id，或空串。
 */
export function currentSessionOf(ctx: { get?(name: string): unknown }): string {
  const sessions = ctx.get?.('sessions') as SessionsServiceLike | null | undefined
  const snapshot = snapshotOf(sessions)
  const current = snapshot?.current
  if (typeof current === 'string' && current) return current
  return mainViewSessionOf(snapshot)
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
