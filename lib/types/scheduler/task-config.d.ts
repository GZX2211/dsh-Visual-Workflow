import type { ScheduledTask } from '../shared/types.js';
/** 请求体形状非法（消息为中文；HTTP 端点转 400，其它调用方按输入错误处理）。 */
export declare class ScheduledTaskInputError extends Error {
    constructor(message: string);
}
/**
 * 请求体（未知形状）→ 定时任务实体：逐字段收敛类型 + id 前缀校验。
 * 只做形状收敛，不做业务规则校验（由 validateScheduledTask 负责）——
 * 因此调用方顺序固定为 parse → validate → normalize。
 *
 * 注意 daysOfWeek 走 Number 强制转换（旧行为：`null` → 0 视为周日），
 * 非法值在 normalizeScheduledTask 中被过滤，此处不提前丢弃。
 *
 * @param options.now 时间戳注入（测试可控；缺省系统时钟）
 */
export declare function parseScheduledTaskInput(raw: unknown, options?: {
    now?: () => number;
}): ScheduledTask;
/**
 * 任务配置校验（字段级中文错误消息；返回 null 表示有效）。
 * 依据：prompt/定时任务开发.md §二（intervalMinutes 1..1439、timePoints 升序等硬性规则）。
 */
export declare function validateScheduledTask(task: Pick<ScheduledTask, 'name' | 'workflowTemplateId' | 'sessionMode' | 'ownerSessionId' | 'timezone' | 'window' | 'triggerMode' | 'dailyTimeConfig' | 'intervalConfig'>): string | null;
/** 任务规范化（保存前补齐/清洗：名称 trim、时刻升序去重、policy 兜底）。 */
export declare function normalizeScheduledTask(task: ScheduledTask): ScheduledTask;
