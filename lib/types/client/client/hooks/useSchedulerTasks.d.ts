import type { ScheduledTask, ScheduledTaskView } from '../../host/shared/types.js';
import type { RemoteFace } from './useRemote.js';
/** 模板下拉条目（仅需要 id/name；mode 用于筛选可调度模板）。 */
export interface TemplateOption {
    id: string;
    name?: string;
    description?: string;
    mode?: string;
}
export interface SchedulerTasksFace {
    views: ScheduledTaskView[];
    templates: TemplateOption[];
    busy: boolean;
    /** 加载任务与模板；返回本次结果供调用方初始化选择（不写组件状态）。 */
    load(): Promise<{
        views: ScheduledTaskView[];
        templates: TemplateOption[];
    }>;
    saveTask(task: ScheduledTask): Promise<ScheduledTask>;
    deleteTask(taskId: string): Promise<void>;
}
export declare function useSchedulerTasks(remote: RemoteFace): SchedulerTasksFace;
