/** 运行/节点状态词典的最小消费面。 */
export interface RunStatusDict {
    status: Record<string, string>;
}
/** 定时任务词典的最小消费面。 */
export interface SchedulerStatusDict {
    schedulerStatus: Record<string, string>;
    schedulerLastResult: Record<string, string>;
}
/** 运行/节点状态文案；未知状态或空值返回空串（调用方按需要回退原文或占位符）。 */
export declare function statusLabelOf(copy: RunStatusDict, status: string | null | undefined): string;
/** 定时任务运行状态文案；未知状态回退状态码本身（便于排查新状态）。 */
export declare function schedulerStatusLabelOf(copy: SchedulerStatusDict, status: string | null | undefined): string;
/** 定时任务最近结果文案；无结果返回占位符「—」。 */
export declare function schedulerResultLabelOf(copy: SchedulerStatusDict, result: string | null | undefined): string;
