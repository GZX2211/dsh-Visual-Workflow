// src/host/remote/api-scheduler.ts
//
// GUI API 定时任务端点（VisualWorkflowApiScheduler extends Catalog；继承链最后一层
// 之前插入）：任务列表（含运行态合并）/ 保存（校验+规范化）/ 删除（解绑运行时）。
// 单一职责：只做 HTTP 参数校验、工作区输入校验与端点映射；任务的形状收敛、业务
// 校验与规范化全部归 scheduler 模块（见 scheduler/task-config.ts），调度决策见
// scheduler 引擎。
import { httpError } from './http.js';
import { VisualWorkflowApiRuns } from './api-runs.js';
import { normalizeScheduledTask, parseScheduledTaskInput, ScheduledTaskInputError, validateScheduledTask, } from '../scheduler/index.js';
import { resolveWorkspacePath } from '../workspace-path.js';
/**
 * GUI API 定时任务端点（挂在继承链末端：Base ← Workflows ← Templates ← Ecosystem ←
 * Catalog ← Runs ← Scheduler ← 最终类；与既有继承链零破坏）。
 */
export class VisualWorkflowApiScheduler extends VisualWorkflowApiRuns {
    /** 定时任务列表（任务 + 引擎运行态视图）。 */
    async schedulerTasks() {
        const scheduler = this.host.scheduler;
        if (!scheduler)
            throw httpError(501, '定时任务引擎不可用');
        return scheduler.listViews();
    }
    /**
     * 保存定时任务（新建/更新统一）：
     *   - 请求体 → 任务实体（形状收敛 + id 前缀校验）归 scheduler 模块；
     *   - 字段校验（validateScheduledTask，中文错误消息）后规范化落盘；
     *   - 新会话工作区在此处校验（输入校验属接受用户输入的端点）；
     *   - configUpdate=immediate：保存后无需等待次日，下一 tick 即按新配置决策。
     */
    async schedulerTaskPut(args) {
        let task;
        try {
            task = parseScheduledTaskInput(args?.task);
        }
        catch (error) {
            if (error instanceof ScheduledTaskInputError)
                throw httpError(400, error.message);
            throw error;
        }
        const validation = validateScheduledTask(task);
        if (validation !== null)
            throw httpError(400, validation);
        // 新会话工作区校验（存在且为目录；new-session 模式下无效路径直接报错）
        if (task.sessionMode === 'new-session' && String(task.workspacePath ?? '').trim()) {
            try {
                await resolveWorkspacePath(task.workspacePath);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw httpError(400, message);
            }
        }
        const store = this.host.schedulerTaskStore;
        if (!store)
            throw httpError(501, '定时任务存储不可用');
        const saved = await store.save(normalizeScheduledTask(task));
        return saved;
    }
    /** 删除定时任务（运行中 run 不受影响，仅解绑引擎引用）。 */
    async schedulerTaskDelete(args) {
        const taskId = String(args?.taskId ?? '');
        if (!taskId)
            throw httpError(400, 'requires taskId');
        const store = this.host.schedulerTaskStore;
        if (!store)
            throw httpError(501, '定时任务存储不可用');
        const deleted = await store.delete(taskId);
        if (deleted)
            await this.host.scheduler?.forgetTask(taskId);
        return { deleted };
    }
}
//# sourceMappingURL=api-scheduler.js.map