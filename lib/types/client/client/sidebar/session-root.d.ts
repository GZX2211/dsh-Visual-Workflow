/** 官方 sessions.list 快照的最小形状（运行时守卫后收窄）。 */
export interface SessionsSnapshotLike {
    /** 当前选中会话 id。 */
    current?: unknown;
    /** 会话 id → 摘要（含父链字段）。 */
    byId?: Record<string, unknown>;
}
/** 官方 sessions 服务的最小形状（快照读 + 订阅；双版本读法）。 */
export interface SessionsServiceLike {
    list?: {
        getSnapshot?(): SessionsSnapshotLike | undefined;
        get?(): SessionsSnapshotLike | undefined;
        subscribe?(fn: () => void): () => void;
    } | null;
}
/**
 * 解析当前选中会话 id（无会话返回空串）。
 * @param ctx - 取服务的最小上下文（`get(name)`）。
 * @returns 当前会话 id，或空串。
 */
export declare function currentSessionOf(ctx: {
    get?(name: string): unknown;
}): string;
/**
 * 沿父链上溯到会话树根（无父/父不在快照中即返回自身；带环检测）。
 * @param current - 当前选中会话 id。
 * @param sessions - 官方 sessions 服务（可空）。
 * @returns 会话树根 id；current 为空时返回空串。
 */
export declare function rootSessionIdOf(current: string, sessions: SessionsServiceLike | null | undefined): string;
