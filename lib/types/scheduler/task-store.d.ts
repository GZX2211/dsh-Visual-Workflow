import type { ScheduledTask } from '../shared/types.js';
/** 引擎持久化运行时字段（内存态的跨重启保留子集；状态 status 由引擎从 run 状态派生）。 */
export interface PersistedRuntime {
    /** 本轮 run id（引擎触发的；用户接管后清空）。 */
    currentRunId: string | null;
    /** 本轮实际执行会话 id。 */
    currentSessionId: string | null;
    /** 本轮实际执行实例（工作流）id。 */
    currentFlowId: string | null;
    /** 被窗口 end 挂起、等待下一窗口续跑的 run id（无 = 非引擎窗口暂停）。 */
    windowPausedRunId: string | null;
    /** 最近消费的触发点（UTC 毫秒；触发/skip 后推进，杜绝重复触发与重复 skip 记录）。 */
    lastConsumedTriggerAt: number | null;
    /** 最近一次触发时刻（ISO 字符串）。 */
    lastTriggeredAt: string | null;
    /** 最近一次触发结果。 */
    lastResult: 'started' | 'resumed' | 'failed' | 'skipped' | null;
    /** 最近一次错误信息。 */
    lastError: string;
}
/** 空运行时（所有 key 的缺省值）。 */
export declare function emptyPersistedRuntime(): PersistedRuntime;
/**
 * 定时任务存储：任务 CRUD + 运行时字段读写。
 * 目录归属 dataDir 根（与 combos.json 平级；init 由 FlowStore 幂等建目录）。
 */
export declare class SchedulerTaskStore {
    private readonly root;
    constructor(root: string);
    private path;
    private readState;
    /** 列出全部任务（按 updatedAt 倒序）。 */
    list(): Promise<ScheduledTask[]>;
    /** 保存任务（新建/更新统一；id 须为 task- 前缀）。 */
    save(task: ScheduledTask): Promise<ScheduledTask>;
    /** 删除任务（返回是否删除成功；运行中 run 不受影响，由引擎解绑）。 */
    delete(taskId: string): Promise<boolean>;
    /** 读取某个任务的持久化运行时（缺省返回空运行时）。 */
    readRuntime(taskId: string): Promise<PersistedRuntime>;
    /** 写入某个任务的持久化运行时（引擎状态迁移时调用；原子合并，不影响其他任务）。 */
    writeRuntime(taskId: string, runtime: PersistedRuntime): Promise<void>;
}
