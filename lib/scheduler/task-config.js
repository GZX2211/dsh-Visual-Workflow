// src/host/scheduler/task-config.ts
//
// 定时任务配置契约（纯函数，零 IO）——三个层次严格分开：
//   1. parseScheduledTaskInput：未知请求体 → 任务实体形状收敛（含 id 前缀校验）；
//   2. validateScheduledTask：字段级业务规则校验（返回中文错误消息或 null）；
//   3. normalizeScheduledTask：保存前补齐/清洗（名称 trim、时刻升序去重、策略兜底）。
//
// 依据：prompt/定时任务开发.md §二（intervalMinutes 1..1439、timePoints 升序等硬性规则）。
// 为什么独立于窗口/触发计算：本层的变化依据是「任务字段与业务规则」，与时间算法无关。
import { parseDateOnly, parseTime } from './calendar.js';
/** 请求体形状非法（消息为中文；HTTP 端点转 400，其它调用方按输入错误处理）。 */
export class ScheduledTaskInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScheduledTaskInputError';
    }
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
export function parseScheduledTaskInput(raw, options = {}) {
    if (!raw || typeof raw !== 'object')
        throw new ScheduledTaskInputError('requires task');
    const input = raw;
    const taskId = String(input.taskId ?? '');
    if (!taskId || !taskId.startsWith('task-'))
        throw new ScheduledTaskInputError('定时任务 id 必须以 task- 前缀');
    const now = new Date(options.now?.() ?? Date.now()).toISOString();
    return {
        ...input,
        taskId,
        name: String(input.name ?? ''),
        workflowTemplateId: String(input.workflowTemplateId ?? ''),
        sessionMode: input.sessionMode === 'current-session' ? 'current-session' : 'new-session',
        ownerSessionId: String(input.ownerSessionId ?? ''),
        enabled: input.enabled !== false,
        timezone: String(input.timezone ?? ''),
        window: {
            startDate: String(input.window?.startDate ?? ''),
            endDate: String(input.window?.endDate ?? ''),
            daysOfWeek: Array.isArray(input.window?.daysOfWeek) ? input.window.daysOfWeek.map(Number) : [],
            timeRanges: Array.isArray(input.window?.timeRanges)
                ? input.window.timeRanges.map((range) => ({
                    start: String(range?.start ?? ''),
                    end: String(range?.end ?? ''),
                }))
                : [],
            unbounded: input.window?.unbounded === true,
        },
        triggerMode: input.triggerMode === 'interval' ? 'interval' : 'daily_time',
        dailyTimeConfig: input.dailyTimeConfig
            ? { timePoints: (Array.isArray(input.dailyTimeConfig.timePoints) ? input.dailyTimeConfig.timePoints : []).map(String) }
            : null,
        intervalConfig: input.intervalConfig
            ? { intervalMinutes: Number(input.intervalConfig.intervalMinutes), startFrom: String(input.intervalConfig.startFrom ?? '') }
            : null,
        runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
        // 新会话工作区（仅 new-session 模式生效；空值忽略）
        ...(String(input.workspacePath ?? '').trim() ? { workspacePath: String(input.workspacePath).trim() } : {}),
        createdAt: String(input.createdAt ?? now),
        updatedAt: now,
    };
}
/**
 * 任务配置校验（字段级中文错误消息；返回 null 表示有效）。
 * 依据：prompt/定时任务开发.md §二（intervalMinutes 1..1439、timePoints 升序等硬性规则）。
 */
export function validateScheduledTask(task) {
    if (!String(task?.name ?? '').trim())
        return '任务名称不能为空';
    if (!String(task?.workflowTemplateId ?? '').trim())
        return '请选择工作流模板';
    if (task.sessionMode !== 'new-session' && task.sessionMode !== 'current-session')
        return '会话策略无效';
    if (!String(task?.ownerSessionId ?? '').trim())
        return '缺少归属会话';
    if (!String(task?.timezone ?? '').trim())
        return '时区不能为空';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: task.timezone });
    }
    catch {
        return '时区无效';
    }
    const window = task.window;
    if (window?.unbounded !== true) {
        if (!parseDateOnly(window?.startDate))
            return '起始日期无效';
        if (!parseDateOnly(window?.endDate))
            return '结束日期无效';
        const start = parseDateOnly(window.startDate);
        const end = parseDateOnly(window.endDate);
        if (Date.UTC(start.year, start.month - 1, start.day) > Date.UTC(end.year, end.month - 1, end.day)) {
            return '起始日期不能晚于结束日期';
        }
    }
    const days = window.daysOfWeek ?? [];
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return '有效星期仅支持 0-6（0=周日）';
    }
    const ranges = window.timeRanges ?? [];
    if (ranges.length === 0)
        return '至少需要一个可执行时间段';
    for (const range of ranges) {
        if (parseTime(range?.start) === null || parseTime(range?.end) === null)
            return '时间段格式应为 HH:mm';
    }
    if (task.triggerMode === 'daily_time') {
        const points = (task.dailyTimeConfig?.timePoints ?? []).map(parseTime);
        if (points.length === 0 || points.some((p) => p === null))
            return '定点模式至少需要一个合法触发时刻（HH:mm）';
        const sorted = [...points].sort((a, b) => a - b);
        if (sorted.some((v, i) => i > 0 && v <= sorted[i - 1]))
            return '触发时刻不可重复（请升序填写）';
    }
    else if (task.triggerMode === 'interval') {
        const minutes = Number(task.intervalConfig?.intervalMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1439) {
            return '间隔分钟数必须为 1-1439 的整数';
        }
        if (parseTime(task.intervalConfig?.startFrom) === null)
            return '起始时刻格式应为 HH:mm';
    }
    else {
        return '触发模式无效';
    }
    return null;
}
/** 任务规范化（保存前补齐/清洗：名称 trim、时刻升序去重、policy 兜底）。 */
export function normalizeScheduledTask(task) {
    const normalized = {
        ...task,
        name: String(task?.name ?? '').trim(),
        workflowTemplateId: String(task?.workflowTemplateId ?? ''),
        sessionMode: task?.sessionMode === 'current-session' ? 'current-session' : 'new-session',
        ownerSessionId: String(task?.ownerSessionId ?? ''),
        enabled: task?.enabled !== false,
        timezone: String(task?.timezone ?? '').trim() || 'Asia/Shanghai',
        window: {
            startDate: String(task?.window?.startDate ?? ''),
            endDate: String(task?.window?.endDate ?? ''),
            daysOfWeek: Array.isArray(task?.window?.daysOfWeek)
                ? task.window.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
                : [],
            timeRanges: (task?.window?.timeRanges ?? [])
                .map((range) => ({ start: String(range?.start ?? ''), end: String(range?.end ?? '') }))
                .filter((range) => parseTime(range.start) !== null && parseTime(range.end) !== null),
            unbounded: task?.window?.unbounded === true,
        },
        triggerMode: task?.triggerMode === 'interval' ? 'interval' : 'daily_time',
        dailyTimeConfig: task?.dailyTimeConfig
            ? {
                timePoints: [...new Set((task.dailyTimeConfig.timePoints ?? []).map((v) => String(v).trim()).filter((v) => parseTime(v) !== null))]
                    .sort((a, b) => (parseTime(a) ?? 0) - (parseTime(b) ?? 0)),
            }
            : null,
        intervalConfig: task?.intervalConfig
            ? {
                intervalMinutes: Math.floor(Number(task.intervalConfig.intervalMinutes)) || 120,
                startFrom: String(task.intervalConfig.startFrom ?? '09:00'),
            }
            : null,
        runtimePolicy: {
            missedTrigger: 'skip',
            concurrency: 'skip',
            configUpdate: 'immediate',
        },
    };
    // 工作区路径仅新会话模式有意义：非 new-session 时剥除（避免旧数据残留污染）；
    // new-session 时空值同样剥除（保持存储干净）
    if (normalized.sessionMode !== 'new-session' || !String(normalized.workspacePath ?? '').trim()) {
        delete normalized.workspacePath;
    }
    return normalized;
}
/**
 * 常用时区候选（下拉选择；按使用频次排序，含 UTC/Asia 主要时区）。
 *
 * 归属待裁决：这是**展示建议列表**而非判定契约——当前 host 侧无消费者，Client 侧另有
 * 一份逐项相同的建议列表（跨半区程序隔离无法共用）。二者之一是同一事实的重复维护：
 * 是否提升为共享协议常量、或明确由 UI 独占，属跨模块契约变更，未在本次治理中改动。
 * 因此它不进入模块公共入口（见 ./index.ts）。
 */
export const COMMON_TIMEZONES = [
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Asia/Seoul',
    'Asia/Taipei',
    'Asia/Kolkata',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Australia/Sydney',
    'UTC',
];
//# sourceMappingURL=task-config.js.map