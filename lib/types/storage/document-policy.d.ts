/** 保存选项：陈旧快照冲突保护（旧项目 nextFlowRevision 语义保留）。 */
export interface SaveOptions {
    /** 客户端加载时的 revision；与当前不一致且非 force 时抛冲突。 */
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
/** 剥除前端快照标记（浅拷贝，不修改入参）；keepServerFields=true 时保留 lastPatch。 */
export declare function stripClientMeta<T>(value: T, keepServerFields?: boolean): T;
/** 保存选项 → 是否保留服务端字段（缺省 false：用户保存即清除代理标注）。 */
export declare function keepServerFieldsOf(options: SaveOptions | undefined): boolean;
/** 提取当前 revision（非法/缺失按 0 处理，旧项目 flowRevision 语义）。 */
export declare function flowRevision(value: {
    revision?: number;
} | null): number;
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
