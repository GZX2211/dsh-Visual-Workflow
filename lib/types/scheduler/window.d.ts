import type { ScheduleWindowConfig, TimeRangeConfig } from '../shared/types.js';
/** 时刻（本地分钟）是否落在时间段数组的任一区间（跨天区间 end<=start 视为 [start,1440)∪[0,end)）。 */
export declare function timeInRanges(localMinutes: number, ranges: TimeRangeConfig[]): boolean;
/** 日期（本地）是否有效：unbounded 时忽略日期范围（仅 daysOfWeek）；否则须在 [startDate, endDate] 闭区间内且满足 daysOfWeek（空=每天）。 */
export declare function isValidDate(dateOnly: string, window: ScheduleWindowConfig): boolean;
/**
 * UTC 时刻是否处于执行窗口内（日期范围 + 星期 + 时间段；含跨天区间）。
 * 实现：把每个区间展开为 UTC 瞬时闭开区间 [startUtc, endUtc) 之后直接比对——
 * 跨天区间（end<=start）的 endUtc 取次日的 end 时刻，天然覆盖凌晨段；
 * 扫描覆盖时刻当天与前一天的区间（跨天区间起始于前一日傍晚）。
 */
export declare function isWithinWindow(utcMs: number, window: ScheduleWindowConfig, timeZone: string): boolean;
/**
 * 下一窗口开始时刻（严格晚于 afterUtcMs；返回 UTC 毫秒）。
 * 窗口开始 = 某有效日 D 的某区间 start（跨天区间记为 D 的 start 时刻）。
 * 扫描边界：afterUtcMs 前一日 ~ 前一日 + MAX_SCAN_DAYS。
 */
export declare function nextWindowStartAt(window: ScheduleWindowConfig, timeZone: string, afterUtcMs: number): number | null;
