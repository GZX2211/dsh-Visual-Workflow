// src/host/scheduler/calendar.ts
//
// 日历与时刻基元（纯函数，零 IO/零全局状态/时钟注入）：
//   - 字符串 ⇄ 结构化日期/时刻（"HH:mm" / "YYYY-MM-DD"）；
//   - UTC 毫秒 ⇄ 指定 IANA 时区本地墙钟（Intl.DateTimeFormat 实现，DST 双向近似迭代修正）；
//   - 日历扫描共用上限（无解配置的兜底边界）。
//
// 为什么与窗口/触发计算分开：本层的变化依据是「日历与 IANA 时区规则」，窗口判定与
// 触发策略的变化依据是「任务的调度语义」——两者不会同时变化。上层只经本文件解释
// 时间字符串与换算时区，不各自实现一遍解析。
/** 一天的总分钟数（触发点计算边界）。 */
export const MINUTES_PER_DAY = 24 * 60;
/** 未来扫描天数上限（防止无解配置无限循环；远超任意业务窗口）。 */
export const MAX_SCAN_DAYS = 400;
/** 解析 "HH:mm" 为本地分钟（0..1439）；非法返回 null。 */
export function parseTime(value) {
    const text = String(value ?? '').trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match)
        return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59)
        return null;
    return hour * 60 + minute;
}
/** 本地分钟格式化 "HH:mm"。 */
export function formatMinutes(minutes) {
    const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hour = Math.floor(m / 60);
    const min = m % 60;
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
/** 解析 "YYYY-MM-DD" 为 { year, month, day }；非法返回 null。 */
export function parseDateOnly(value) {
    const text = String(value ?? '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    // 真实性校验（含闰年）
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day)
        return null;
    return { year, month, day };
}
/** 本地日期格式化 "YYYY-MM-DD"。 */
export function formatDateOnly(date) {
    return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
/** 日期偏移（返回新的 {year,month,day}；跨月/跨年由 Date 归一化）。 */
export function addDays(date, days) {
    const utc = Date.UTC(date.year, date.month - 1, date.day) + days * 86_400_000;
    const d = new Date(utc);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
/** 把 UTC 毫秒时间戳展开为指定时区的本地墙钟（Intl 实现，线程安全/无全局状态）。 */
export function zonedParts(utcMs, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(new Date(utcMs));
    const get = (type) => {
        const part = parts.find((item) => item.type === type);
        return Number((part?.value ?? '0').replace(/\D/g, '') || 0);
    };
    const weekdayText = parts.find((item) => item.type === 'weekday')?.value.toLowerCase() ?? '';
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const weekday = Math.max(0, weekdays.indexOf(weekdayText.slice(0, 3)));
    const year = get('year');
    const month = get('month');
    const day = get('day');
    return {
        year,
        month,
        day,
        hour: get('hour'),
        minute: get('minute'),
        second: get('second'),
        weekday,
        dateOnly: formatDateOnly({ year, month, day }),
    };
}
/**
 * 时区本地墙钟 → UTC 毫秒（近似迭代修正；DST 缺口/重叠采用迭代收敛值，确定性。
 * 说明：Asia/Shanghai 等目标时区无 DST，迭代 2-3 次即收敛到秒级精度）。
 * 迭代公式：guess 的本地墙钟名义值 nominal(guess) 与目标墙钟名义值 target 的
 * 差值即偏移误差，真实 UTC = guess - 误差。
 */
export function localToUtc(input, timeZone) {
    // 目标墙钟名义值（把墙钟字段当作 UTC 组装，仅用于差值比较，量纲一致）
    const target = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
    let utc = target;
    for (let i = 0; i < 4; i += 1) {
        const parts = zonedParts(utc, timeZone);
        const nominal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        const error = nominal - target;
        if (error === 0)
            break;
        utc -= error;
    }
    return utc;
}
/** UTC 毫秒 → 指定时区本地日期（"YYYY-MM-DD"）。 */
export function dateOnlyOf(utcMs, timeZone) {
    return zonedParts(utcMs, timeZone).dateOnly;
}
/** UTC 毫秒 → 指定时区星期（0=周日 … 6=周六）。 */
export function weekdayOf(utcMs, timeZone) {
    return zonedParts(utcMs, timeZone).weekday;
}
//# sourceMappingURL=calendar.js.map