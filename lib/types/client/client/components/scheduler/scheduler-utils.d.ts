import type { ScheduledTask, ScheduledTaskView } from '../../../host/shared/types.js';
/** 本地时区（浏览器/Node resolvedOptions；不可用时回退 Asia/Shanghai）。 */
export declare function detectLocalTimezone(): string;
/** 本地日期 "YYYY-MM-DD"（今天）。 */
export declare function localDateOnly(date?: Date): string;
/** 日期偏移（"YYYY-MM-DD"）。 */
export declare function shiftDateOnly(dateOnly: string, days: number): string;
/** 任务 id 生成（`task-` 前缀；与组合 combo- 模式一致）。 */
export declare function newTaskId(): string;
/** 空任务草稿（默认值：今天起 30 天、每天、一个 09:00–18:00 时间段、定点触发 09:00）。 */
export declare function createTaskDraft(ownerSessionId: string, now?: Date): ScheduledTask;
/** 视图 → 草稿（深拷贝，避免表单编辑污染列表数据）。 */
export declare function taskFromView(view: ScheduledTaskView): ScheduledTask;
/** 表单即时校验：返回第一处错误消息（null = 通过基础检查）。 */
export declare function validateTaskDraft(task: ScheduledTask): string | null;
/** 显示格式化：ISO → 本地可读（含时区标识）。 */
export declare function formatIso(value: string | null | undefined): string;
/** 星期标签（0=周日 … 6=周六）。 */
export declare const WEEKDAY_LABELS: readonly ["日", "一", "二", "三", "四", "五", "六"];
