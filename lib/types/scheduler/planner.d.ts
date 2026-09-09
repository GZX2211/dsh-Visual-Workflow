import type { ScheduledTask, ScheduleWindowConfig, TimeRangeConfig } from '../shared/types.js';
/** 一天的总分钟数（触发点计算边界）。 */
export declare const MINUTES_PER_DAY: number;
/** 全局触发起始点（本地分钟）；触发点必须落在 [0, MINUTES_PER_DAY) 内。 */
export declare const DAILY_TIME_MIN_INTERVAL = 1;
/** 未来扫描天数上限（防止无解配置无限循环；远超任意业务窗口）。 */
export declare const MAX_SCAN_DAYS = 400;
/** 解析 "HH:mm" 为本地分钟（0..1439）；非法返回 null。 */
export declare function parseTime(value: unknown): number | null;
/** 本地分钟格式化 "HH:mm"。 */
export declare function formatMinutes(minutes: number): string;
/** 解析 "YYYY-MM-DD" 为 { year, month, day }；非法返回 null。 */
export declare function parseDateOnly(value: unknown): {
    year: number;
    month: number;
    day: number;
} | null;
/** 本地日期格式化 "YYYY-MM-DD"。 */
export declare function formatDateOnly(date: {
    year: number;
    month: number;
    day: number;
}): string;
/** 日期偏移（返回新的 {year,month,day}；跨月/跨年由 Date 归一化）。 */
export declare function addDays(date: {
    year: number;
    month: number;
    day: number;
}, days: number): {
    year: number;
    month: number;
    day: number;
};
/** 指定时区的本地墙钟展开（weekday 0=周日 … 6=周六）。 */
export interface ZonedParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    /** 星期（0=周日）。 */
    weekday: number;
    /** 本地日期（"YYYY-MM-DD"）。 */
    dateOnly: string;
}
/** 把 UTC 毫秒时间戳展开为指定时区的本地墙钟（Intl 实现，线程安全/无全局状态）。 */
export declare function zonedParts(utcMs: number, timeZone: string): ZonedParts;
/**
 * 时区本地墙钟 → UTC 毫秒（近似迭代修正；DST 缺口/重叠采用迭代收敛值，确定性。
 * 说明：Asia/Shanghai 等目标时区无 DST，迭代 2-3 次即收敛到秒级精度）。
 * 迭代公式：guess 的本地墙钟名义值 nominal(guess) 与目标墙钟名义值 target 的
 * 差值即偏移误差，真实 UTC = guess - 误差。
 */
export declare function localToUtc(input: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}, timeZone: string): number;
/** UTC 毫秒 → 指定时区本地日期（"YYYY-MM-DD"）。 */
export declare function dateOnlyOf(utcMs: number, timeZone: string): string;
/** UTC 毫秒 → 指定时区星期（0=周日 … 6=周六）。 */
export declare function weekdayOf(utcMs: number, timeZone: string): number;
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
/** 某本地日期（须有效）上的全部理论触发点（本地分钟，升序；interval 跨天截断）。 */
export declare function triggerPointsForDate(task: Pick<ScheduledTask, 'triggerMode' | 'dailyTimeConfig' | 'intervalConfig'>, dateOnly: string): number[];
/**
 * 下一触发点（严格晚于 afterUtcMs）：扫描本地日期（after 当日 + MAX_SCAN_DAYS），
 * 仅考虑有效日；返回「触发点 ∈ 执行窗口区间」的最近触发时刻（UTC 毫秒）。
 * 窗口外/无有效日 → null（任务永久静默）。
 */
export declare function nextTriggerAt(task: ScheduledTask, afterUtcMs: number, timeZone: string): number | null;
/** 任务级"当前是否处于窗口外"（引擎挂起判定用）：窗口内返回 false。 */
export declare function isTaskWindowOpen(task: ScheduledTask, utcMs: number, timeZone: string): boolean;
/**
 * 任务配置校验（字段级中文错误消息；返回 null 表示有效）。
 * 依据：prompt/定时任务开发.md §二（intervalMinutes 1..1439、timePoints 升序等硬性规则）。
 */
export declare function validateScheduledTask(task: Pick<ScheduledTask, 'name' | 'workflowTemplateId' | 'sessionMode' | 'ownerSessionId' | 'timezone' | 'window' | 'triggerMode' | 'dailyTimeConfig' | 'intervalConfig'>): string | null;
/** 任务规范化（保存前补齐/清洗：名称 trim、时刻升序去重、policy 兜底）。 */
export declare function normalizeScheduledTask(task: ScheduledTask): ScheduledTask;
/** 常用时区候选（下拉选择；按使用频次排序，含 UTC/Asia 主要时区）。 */
export declare const COMMON_TIMEZONES: readonly ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Asia/Seoul", "Asia/Taipei", "Asia/Kolkata", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Sao_Paulo", "Australia/Sydney", "UTC"];
