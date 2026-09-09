import { VisualWorkflowApiRuns } from './api-runs.js';
/**
 * GUI API 定时任务端点（挂在继承链末端：Base ← Workflows ← Templates ← Ecosystem ←
 * Catalog ← Runs ← Scheduler ← 最终类；与既有继承链零破坏）。
 */
export declare class VisualWorkflowApiScheduler extends VisualWorkflowApiRuns {
    /** 定时任务列表（任务 + 引擎运行态视图）。 */
    schedulerTasks(): Promise<unknown>;
    /**
     * 保存定时任务（新建/更新统一）：
     *   - id 须为 task- 前缀（新建由客户端生成，保存后回传归一化结果）；
     *   - 字段校验（validateScheduledTask，中文错误消息）后规范化落盘；
     *   - configUpdate=immediate：保存后无需等待次日，下一 tick 即按新配置决策。
     */
    schedulerTaskPut(args: {
        task?: unknown;
    }): Promise<unknown>;
    /** 删除定时任务（运行中 run 不受影响，仅解绑引擎引用）。 */
    schedulerTaskDelete(args: {
        taskId?: unknown;
    }): Promise<unknown>;
}
