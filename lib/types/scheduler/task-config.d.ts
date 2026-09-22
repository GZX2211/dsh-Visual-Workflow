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
/**
 * 常用时区候选（下拉选择；按使用频次排序，含 UTC/Asia 主要时区）。
 *
 * 归属待裁决：这是**展示建议列表**而非判定契约——当前 host 侧无消费者，Client 侧另有
 * 一份逐项相同的建议列表（跨半区程序隔离无法共用）。二者之一是同一事实的重复维护：
 * 是否提升为共享协议常量、或明确由 UI 独占，属跨模块契约变更，未在本次治理中改动。
 * 因此它不进入模块公共入口（见 ./index.ts）。
 */
export declare const COMMON_TIMEZONES: readonly ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Asia/Seoul", "Asia/Taipei", "Asia/Kolkata", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Sao_Paulo", "Australia/Sydney", "UTC"];
