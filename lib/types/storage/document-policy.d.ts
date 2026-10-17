/** 保存选项：陈旧快照冲突保护（旧项目 nextFlowRevision 语义保留）。 */
export interface SaveOptions {
    expectedRevision?: number | null;
    /** 强制覆盖（跳过冲突检查）。 */
    force?: boolean;
    /**
     * 保留服务端字段（`lastPatch`，P4 代理补丁标注）。
     * 缺省 false = 用户保存路径：清除代理标注（用户已看过/改过画布）。
     * 只有 `wf_graph_patch` 的代理补丁路径传 true（否则刚写的标注会被自己剥掉）。
     */
    keepServerFields?: boolean;
}
/** revision 冲突错误：另一会话已保存更新的版本（架构文档 §4.1 原子性与锁一致）。 */
export declare class FlowRevisionConflictError extends Error {
    readonly id: string;
    readonly expectedRevision: number | null;
    readonly actualRevision: number;
    readonly code = "FLOW_REVISION_CONFLICT";
    constructor(id: string, expectedRevision: number | null, actualRevision: number);
}
/**
 * 目标资源不存在或不属于该会话（写路径归属校验失败）。
 *
 * 为什么与「不存在」同码同文案：归属不匹配必须按「不存在」处理，否则调用方可据响应
 * 区分「他人资源」与「无此资源」（存在性预言）；与读取/删除路径的隔离口径一致。
 */
export declare class FlowNotFoundError extends Error {
    readonly id: string;
    readonly code = "FLOW_NOT_FOUND";
    constructor(id: string);
}
/** 剥除前端快照标记（浅拷贝，不修改入参）；keepServerFields=true 时保留 lastPatch。 */
export declare function stripClientMeta<T>(value: T, keepServerFields?: boolean): T;
/** 保存选项 → 是否保留服务端字段（缺省 false：用户保存即清除代理标注）。 */
export declare function keepServerFieldsOf(options: SaveOptions | undefined): boolean;
/** 提取当前 revision（非法/缺失按 0 处理，旧项目 flowRevision 语义）。 */
export declare function flowRevision(value: {
    revision?: number;
} | null): number;
/** 落盘文档的公共结构：身份字段 + 时间戳（run 快照的时间语义在 startedAt/endedAt 上）。 */
export interface StoredDocument {
    id: string;
    createdAt?: string;
    updatedAt?: string;
}
/** 版本化文档结构：workflow / service / flow-template 三类资源共有的记账字段。 */
export interface VersionedDocument extends StoredDocument {
    revision?: number;
}
/**
 * 非版本化文档的发布策略：前端标记剥除 + 时间戳继承（模板没有 revision 字段，
 * 不因本策略新增字段——落盘形状保持不变）。
 *
 * createdAt 取「调用方值 ?? 既有值 ?? now」：更新时不得把创建时间重置为当前时间。
 * updatedAt 恒为本刻：调用方传入的值不得覆盖。
 */
export declare function publishDocument<T extends StoredDocument>(incoming: T, current: T | null, now: string): T;
/**
 * 版本化文档的发布策略：前端标记剥除 + revision 记账 + 时间戳继承。
 *
 * 为什么必须收敛到这一处：净化与 revision/时间戳记账一旦分散到多个写入入口，任何一处漏掉
 * 净化或写错时间戳继承都会静默改变落盘形状与乐观锁语义；本函数是 `saveWorkflow` /
 * `writeServiceDoc` / `saveFlowTemplate` 三处的唯一决策点。
 * 本函数只决策、不做 IO——读改写与落盘仍由调用方在同一临界区内完成（见 ./AGENTS.md）。
 *
 * @param incoming 调用方提交的文档（可能携带仅前端的临时标记）。
 * @param current 该文件的既有内容（不存在传 null，revision 从 1 起）。
 * @param options 乐观锁期望（显式传入才生效）与服务端字段保留开关。
 * @param now 本次发布的更新时间（由调用方取，便于测试确定化）。
 */
export declare function publishVersionedDocument<T extends VersionedDocument>(incoming: T, current: T | null, options: SaveOptions, now: string): T;
/**
 * 计算保存后的 revision：无显式冲突期望时自动 +1；有期望时必须匹配（除非 force）。
 * 为什么只认显式 expectedRevision（不沿用旧项目 incoming.revision 回退）：文档内
 * revision 是存储层记账字段，保存方携带的任意快照值不应隐式变成冲突期望——
 * 否则"复制快照再保存"会误触发乐观锁（旧项目客户端每次显式传 expectedRevision，
 * 本项目把该语义收敛为显式参数）。
 */
export declare function nextFlowRevision(incoming: {
    revision?: number;
    id?: string;
}, current: {
    revision?: number;
} | null, options?: SaveOptions): number;
