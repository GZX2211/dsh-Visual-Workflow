// src/host/scheduler/window.ts
//
// 执行窗口判定（纯函数，零 IO/零时钟读取）——调度语义的第一层：
//   - 日期范围（闭区间；unbounded 时忽略）× 星期（空=每天）× 时间段（可多个）；
//   - 跨天区间（end <= start，如 22:00–06:00）覆盖次日凌晨；
//   - 下一窗口开始时刻推算（nextWindowStartAt）。
//
// 窗口是「触发的前提」：触发点必须同时落在窗口内才执行（第二层见 ./trigger.ts）。
// 本层的判定全部基于调用方传入的 UTC 毫秒，不读系统时钟。
import { addDays, dateOnlyOf, formatDateOnly, localToUtc, MAX_SCAN_DAYS, parseDateOnly, parseTime, } from './calendar.js';
/** 时刻（本地分钟）是否落在时间段数组的任一区间（跨天区间 end<=start 视为 [start,1440)∪[0,end)）。 */
export function timeInRanges(localMinutes, ranges) {
    for (const range of ranges ?? []) {
        const start = parseTime(range.start);
        const end = parseTime(range.end);
        if (start === null || end === null)
            continue;
        if (end > start) {
            if (localMinutes >= start && localMinutes < end)
                return true;
        }
        else {
            // 跨天区间：当天 [start, 1440) ∪ 凌晨 [0, end)
            if (localMinutes >= start || localMinutes < end)
                return true;
        }
    }
    return false;
}
/** 日期（本地）是否有效：unbounded 时忽略日期范围（仅 daysOfWeek）；否则须在 [startDate, endDate] 闭区间内且满足 daysOfWeek（空=每天）。 */
export function isValidDate(dateOnly, window) {
    const parsed = parseDateOnly(dateOnly);
    if (!parsed)
        return false;
    const key = (d) => Date.UTC(d.year, d.month - 1, d.day);
    if (window.unbounded !== true) {
        const start = parseDateOnly(window.startDate);
        const end = parseDateOnly(window.endDate);
        if (!start || !end)
            return false;
        if (key(parsed) < key(start) || key(parsed) > key(end))
            return false;
    }
    const days = window.daysOfWeek ?? [];
    if (days.length === 0)
        return true;
    const weekday = new Date(key(parsed)).getUTCDay();
    return days.includes(weekday);
}
/**
 * 计算某本地日期 D 上「生效」的窗口区间列表（即该日期内窗口为「开」的时刻范围）：
 *   - 非跨天区间 [s,e)：D 的 [s,e)（要求 D 有效）；
 *   - 跨天区间 [s,1440)∪[0,e)：D 的凌晨段 [0,e)（起始日 = D-1，要求 D-1 有效）。
 * 供 UI/调试展示用；窗口判定以 isWithinWindow（瞬时边界比对）为准。
 */
export function windowSpansOfDate(dateOnly, window) {
    const spans = [];
    const ranges = window.timeRanges ?? [];
    for (const range of ranges) {
        const start = parseTime(range.start);
        const end = parseTime(range.end);
        if (start === null || end === null)
            continue;
        const crossings = end <= start;
        if (!crossings) {
            if (isValidDate(dateOnly, window)) {
                spans.push({ startMin: start, endMin: end, startDate: dateOnly, crossesDays: false });
            }
            continue;
        }
        // 跨天：凌晨部分 [0,end) 属于前一日的区间（起始日 = dateOnly - 1）
        const prev = addDays(parseDateOnly(dateOnly) ?? { year: 1970, month: 1, day: 1 }, -1);
        const prevDate = formatDateOnly(prev);
        if (isValidDate(prevDate, window)) {
            spans.push({ startMin: start, endMin: end, startDate: prevDate, crossesDays: true });
        }
    }
    return spans;
}
/**
 * UTC 时刻是否处于执行窗口内（日期范围 + 星期 + 时间段；含跨天区间）。
 * 实现：把每个区间展开为 UTC 瞬时闭开区间 [startUtc, endUtc) 之后直接比对——
 * 跨天区间（end<=start）的 endUtc 取次日的 end 时刻，天然覆盖凌晨段；
 * 扫描覆盖时刻当天与前一天的区间（跨天区间起始于前一日傍晚）。
 */
export function isWithinWindow(utcMs, window, timeZone) {
    const today = parseDateOnly(dateOnlyOf(utcMs, timeZone)) ?? { year: 1970, month: 1, day: 1 };
    const days = [today, addDays(today, -1)];
    for (const day of days) {
        for (const range of window.timeRanges ?? []) {
            const start = parseTime(range.start);
            const end = parseTime(range.end);
            if (start === null || end === null)
                continue;
            const startDate = formatDateOnly(day);
            if (!isValidDate(startDate, window))
                continue;
            const startUtc = localToUtc({ ...day, hour: Math.floor(start / 60), minute: start % 60 }, timeZone);
            const endDay = end <= start ? addDays(day, 1) : day;
            const endUtc = localToUtc({ ...endDay, hour: Math.floor(end / 60), minute: end % 60 }, timeZone);
            if (startUtc <= utcMs && utcMs < endUtc)
                return true;
        }
    }
    return false;
}
/**
 * 下一窗口开始时刻（严格晚于 afterUtcMs；返回 UTC 毫秒）。
 * 窗口开始 = 某有效日 D 的某区间 start（跨天区间记为 D 的 start 时刻）。
 * 扫描边界：afterUtcMs 前一日 ~ 前一日 + MAX_SCAN_DAYS。
 */
export function nextWindowStartAt(window, timeZone, afterUtcMs) {
    const after = dateOnlyOf(afterUtcMs, timeZone);
    const afterParsed = parseDateOnly(after) ?? { year: 1970, month: 1, day: 1 };
    const candidates = [];
    for (let offset = -1; offset <= MAX_SCAN_DAYS; offset += 1) {
        const date = addDays(afterParsed, offset);
        const dateOnly = formatDateOnly(date);
        if (!isValidDate(dateOnly, window))
            continue;
        for (const range of window.timeRanges ?? []) {
            const start = parseTime(range.start);
            if (start === null)
                continue;
            const startUtc = localToUtc({ ...date, hour: Math.floor(start / 60), minute: start % 60 }, timeZone);
            if (startUtc > afterUtcMs)
                candidates.push(startUtc);
        }
    }
    if (candidates.length === 0)
        return null;
    return Math.min(...candidates);
}
//# sourceMappingURL=window.js.map