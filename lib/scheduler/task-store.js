// src/host/scheduler/task-store.ts
//
// 定时任务持久化（scheduler-tasks.json 单文件，与 combos.json 同模式）：
//   - 文件形态：{ tasks: ScheduledTask[], runtimes: Record<taskId, PersistedRuntime> }
//   - 全部写操作经 withJsonLock + atomicWriteJson（临时文件 + fsync + 原子发布）；
//   - 任务全局共享（跨会话可见，与工作流模板一致）；runtimes 为引擎内存态的
//     关键字段落盘（窗口暂停续跑/触发消费点跨重启保持）。
//
// 单一职责：只做 list/save/delete 与运行时字段的读写，调度决策见 engine.ts。
import { join } from 'node:path';
import { atomicWriteJson, CorruptJsonError, readJson, withJsonLock } from '../storage/atomic.js';
/** 空运行时（所有 key 的缺省值）。 */
export function emptyPersistedRuntime() {
    return {
        currentRunId: null,
        currentSessionId: null,
        currentFlowId: null,
        windowPausedRunId: null,
        lastConsumedTriggerAt: null,
        lastTriggeredAt: null,
        lastResult: null,
        lastError: '',
    };
}
/**
 * 定时任务存储：任务 CRUD + 运行时字段读写。
 * 目录归属 dataDir 根（与 combos.json 平级；init 由 FlowStore 幂等建目录）。
 */
export class SchedulerTaskStore {
    root;
    constructor(root) {
        this.root = root;
    }
    path() {
        return join(this.root, 'scheduler-tasks.json');
    }
    async readState() {
        let state;
        try {
            state = await readJson(this.path(), null);
        }
        catch (error) {
            // 损坏 JSON：按空列表处置（与 FlowStore 列表读取的损坏容忍一致，Bug 21 语义），
            // 避免一个坏文件让调度器整体瘫痪；后续保存会重写完整文件。
            if (error instanceof CorruptJsonError)
                return { tasks: [], runtimes: {} };
            throw error;
        }
        return {
            tasks: Array.isArray(state?.tasks) ? state.tasks : [],
            runtimes: state?.runtimes && typeof state.runtimes === 'object' ? state.runtimes : {},
        };
    }
    /** 列出全部任务（按 updatedAt 倒序）。 */
    async list() {
        const state = await this.readState();
        return [...state.tasks].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    }
    /** 保存任务（新建/更新统一；id 须为 task- 前缀）。 */
    async save(task) {
        if (!String(task?.taskId ?? '').startsWith('task-'))
            throw new Error('定时任务 id 必须以 task- 前缀');
        const path = this.path();
        return withJsonLock(path, async () => {
            const state = await this.readState();
            const tasks = [task, ...state.tasks.filter((item) => item.taskId !== task.taskId)];
            await atomicWriteJson(path, { tasks, runtimes: state.runtimes });
            return task;
        });
    }
    /** 删除任务（返回是否删除成功；运行中 run 不受影响，由引擎解绑）。 */
    async delete(taskId) {
        const path = this.path();
        return withJsonLock(path, async () => {
            const state = await this.readState();
            const existed = state.tasks.some((item) => item.taskId === taskId);
            if (!existed)
                return false;
            const runtimes = { ...state.runtimes };
            delete runtimes[taskId];
            await atomicWriteJson(path, { tasks: state.tasks.filter((item) => item.taskId !== taskId), runtimes });
            return true;
        });
    }
    /** 读取某个任务的持久化运行时（缺省返回空运行时）。 */
    async readRuntime(taskId) {
        const state = await this.readState();
        return state.runtimes[taskId] ?? emptyPersistedRuntime();
    }
    /** 写入某个任务的持久化运行时（引擎状态迁移时调用；原子合并，不影响其他任务）。 */
    async writeRuntime(taskId, runtime) {
        const path = this.path();
        return withJsonLock(path, async () => {
            const state = await this.readState();
            await atomicWriteJson(path, {
                tasks: state.tasks,
                runtimes: { ...state.runtimes, [taskId]: runtime },
            });
        });
    }
}
//# sourceMappingURL=task-store.js.map