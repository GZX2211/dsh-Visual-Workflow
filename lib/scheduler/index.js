// src/host/scheduler/index.ts
//
// 定时任务模块**唯一公共入口**（barrel）：
//   - 模块外（host 装配 / remote 端点 / service 进程入口及全部测试）一律从本入口
//     导入，不得直接引用模块内部文件（见同目录 AGENTS.md「公共边界」）；
//   - 内部文件之间仍使用相对路径导入；本文件不含任何实现。
//
// 刻意**不**在本入口公开的内部实现（它们不是对外契约）：
//   - 单任务决策的状态迁移细节（engine 的私有方法）；
//   - 任务文件的磁盘形态（task-store 的私有 readState / 内部路径计算）；
//   - 引擎的内存缓存与定时器内部结构；
//   - 算法内部边界常量与引擎默认参数（扫描上限、触发间隔下限、默认 tick）：调用方
//     需要时经依赖缝显式传入，而不是依赖实现常量。
// 若确实需要公开其中某项，先判断它是否表达真实、稳定、可维护的对外契约，
// 再在本文件显式登记——不要为「方便」整体 re-export 内部文件。
// ── 调度引擎与装配缝 ─────────────────────────────────────────────────────
export { SchedulerEngine } from './engine.js';
// ── 任务持久化（任务 CRUD + 运行时字段落盘）──────────────────────────────
export { emptyPersistedRuntime, SchedulerTaskStore } from './task-store.js';
// ── 任务配置契约（请求收敛 → 业务校验 → 保存前规范化）────────────────────
export { normalizeScheduledTask, parseScheduledTaskInput, ScheduledTaskInputError, validateScheduledTask, } from './task-config.js';
// ── 日历与时刻基元（含 IANA 时区换算）─────────────────────────────────────
export { addDays, dateOnlyOf, formatDateOnly, formatMinutes, localToUtc, parseDateOnly, parseTime, weekdayOf, zonedParts, } from './calendar.js';
// ── 执行窗口判定（第一层）────────────────────────────────────────────────
export { isValidDate, isWithinWindow, nextWindowStartAt, timeInRanges, windowSpansOfDate } from './window.js';
// ── 触发点计算（第二层）──────────────────────────────────────────────────
export { nextTriggerAt, triggerPointsForDate } from './trigger.js';
// ── 模板 → 实例（触发时刻的实例化语义）────────────────────────────────────
export { instantiateFromTemplate, overwriteInstanceFromTemplate } from './instantiate.js';
//# sourceMappingURL=index.js.map