/** 一天的总分钟数（触发点计算边界）。 */
export declare const MINUTES_PER_DAY: number;
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
