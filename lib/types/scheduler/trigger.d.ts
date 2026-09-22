import type { ScheduledTask } from '../shared/types.js';
/** 间隔模式的最小间隔（分钟）；触发点必须落在 [0, MINUTES_PER_DAY) 内。 */
export declare const DAILY_TIME_MIN_INTERVAL = 1;
/** 某本地日期（须有效）上的全部理论触发点（本地分钟，升序；interval 跨天截断）。 */
export declare function triggerPointsForDate(task: Pick<ScheduledTask, 'triggerMode' | 'dailyTimeConfig' | 'intervalConfig'>, dateOnly: string): number[];
/**
 * 下一触发点（严格晚于 afterUtcMs）：扫描本地日期（after 当日 + MAX_SCAN_DAYS），
 * 仅考虑有效日；返回「触发点 ∈ 执行窗口区间」的最近触发时刻（UTC 毫秒）。
 * 窗口外/无有效日 → null（任务永久静默）。
 */
export declare function nextTriggerAt(task: ScheduledTask, afterUtcMs: number, timeZone: string): number | null;
