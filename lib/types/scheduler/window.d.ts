import type { ScheduleWindowConfig, TimeRangeConfig } from '../shared/types.js';
/** 时刻（本地分钟）是否落在时间段数组的任一区间（跨天区间 end<=start 视为 [start,1440)∪[0,end)）。 */
export declare function timeInRanges(localMinutes: number, ranges: TimeRangeConfig[]): boolean;
/** 日期（本地）是否有效：unbounded 时忽略日期范围（仅 daysOfWeek）；否则须在 [startDate, endDate] 闭区间内且满足 daysOfWeek（空=每天）。 */
export declare function isValidDate(dateOnly: string, window: ScheduleWindowConfig): boolean;
/** 某本地日期上覆盖到的全部窗口区间（含前一日跨天区间延伸到本日的情形）。 */
export interface WindowSpan {
    /** 窗口开始（本地分钟；跨天区间时为前一日 start）。 */
    startMin: number;
    /** 窗口结束（本地分钟；跨天区间时为次日 end）。 */
    endMin: number;
    /** 窗口起始所属的本地日期（跨天区间凌晨部分属于前一日）。 */
    startDate: string;
    /** 该区间是否跨天。 */
    crossesDays: boolean;
}
/**
 * 计算某本地日期 D 上「生效」的窗口区间列表（即该日期内窗口为「开」的时刻范围）：
 *   - 非跨天区间 [s,e)：D 的 [s,e)（要求 D 有效）；
 *   - 跨天区间 [s,1440)∪[0,e)：D 的凌晨段 [0,e)（起始日 = D-1，要求 D-1 有效）。
 * 供 UI/调试展示用；窗口判定以 isWithinWindow（瞬时边界比对）为准。
 */
export declare function windowSpansOfDate(dateOnly: string, window: ScheduleWindowConfig): WindowSpan[];
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
