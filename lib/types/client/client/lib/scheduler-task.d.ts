import type { ScheduledTask, ScheduledTaskView } from '../../host/shared/types.js';
/** 时区探测不可用时的兜底时区（宿主契约 ScheduledTask.timezone 必填；界面须同时显式提示）。 */
export declare const FALLBACK_TIMEZONE = "Asia/Shanghai";
/**
 * 本地时区（浏览器/Node resolvedOptions）。探测不可用返回 null —— 不静默按上海解释：
 * 把未知时区当成已知事实会让全部触发时刻整体偏移，故由调用方提示用户手动选择
 * （SchedulerManager 的 schedulerTimezoneUnavailable；草稿落库另用 FALLBACK_TIMEZONE）。
 */
export declare function detectLocalTimezone(): string | null;
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
/**
 * 显示格式化：ISO → 本地可读。
 * locale 由调用方从词典注入（lib 不持有词典）：年月日/时分顺序与 AM/PM 表达随界面
 * 语言变化，硬编码 'zh-CN' 会让英文界面一直显示中文习惯的日期格式。
 */
export declare function formatIso(value: string | null | undefined, locale: string): string;
