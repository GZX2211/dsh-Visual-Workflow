/** 会话的图补丁记录（磁盘形状即对外契约）。 */
export interface GraphPatchLogRecord {
    /** 会话 id（与文件名同源）。 */
    sessionId: string;
    /** 累计成功应用的图结构补丁次数。 */
    count: number;
    /** 最后一次成功应用时间（ISO 字符串）。 */
    lastAt: string;
    /** 最后一次补丁的目标 id（模板 id 或实例 id）。 */
    lastTargetId: string;
    /** 最后一次补丁的作用域（template / instance）。 */
    lastScope: string;
}
/** 图补丁记录存储（读改写经同一把 withJsonLock，避免并发丢更新）。 */
export declare class GraphPatchLogStore {
    private readonly root;
    constructor(root: string);
    /**
     * 记录一次成功的图结构补丁（幂等语义之外的累加；返回最新记录）。
     * 事务外不读，读改写全部在同一临界区内完成——并发补丁不会互相覆盖计数。
     */
    record(input: {
        sessionId: string;
        targetId: string;
        scope: string;
        now?: number;
    }): Promise<GraphPatchLogRecord>;
    /** 单资源读：不存在返回 null；损坏 JSON 抛带路径的 CorruptJsonError（不伪装成不存在）。 */
    read(sessionId: string): Promise<GraphPatchLogRecord | null>;
    /** 列出已记录的会话 id（宿主启动时装载内存索引用；损坏项跳过以保证可用性）。 */
    listSessionIds(): Promise<string[]>;
}
