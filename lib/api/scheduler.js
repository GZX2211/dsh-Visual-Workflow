// src/host/api/scheduler.ts
//
// GUI API 定时任务端点组（SchedulerEndpoints）：任务列表（含运行态合并）/ 保存
// （校验+规范化）/ 删除（解绑运行时）。单一职责：只做 HTTP 参数校验、工作区输入
// 校验与端点映射；任务的形状收敛、业务校验与规范化全部归 scheduler 模块
// （见 scheduler/task-config.ts），调度决策见 scheduler 引擎。
import { httpError } from './http.js';
import { presentationOf, VisualWorkflowApiBase } from './boundary.js';
import { normalizeScheduledTask, parseScheduledTaskInput, ScheduledTaskInputError, validateScheduledTask, } from '../scheduler/index.js';
import { resolveWorkspacePath } from '../workspace-path.js';
/**
 * GUI API 定时任务端点组（只依赖边界基座，与其他端点组无依赖关系）。
 *
 * K1（用户裁决）：定时任务是**全局共享**资源（跨会话可见，与工作流模板同口径），因此
 * 三个端点都不含 sessionId、也不做会话归属校验——这不是跨会话越权缺口，而是设计意图。
 * 被接受的副作用：`schedulerTaskPut` 采信请求体自报的 ownerSessionId，触发时以该会话为
 * 归属建实例；任何能访问本机 GUI API 的调用方都能管理全部任务（信任边界见 routes.ts 的
 * 「仅本机可信、无应用层鉴权」声明）。
 * 若将来改为按会话隔离，属契约变更（端点签名、客户端调用与既有测试会一并破坏），
 * 不得在本层私自加归属校验。
 */
export class SchedulerEndpoints extends VisualWorkflowApiBase {
    /** 定时任务列表（任务 + 引擎运行态视图）。全局共享：不按会话过滤（K1）。 */
    async schedulerTasks() {
        const scheduler = this.host.scheduler;
        if (!scheduler)
            throw httpError(501, presentationOf(this.host, '定时任务引擎不可用', 'Scheduler engine is unavailable'));
        return scheduler.listViews();
    }
    /**
     * 保存定时任务（新建/更新统一）：
     *   - 请求体 → 任务实体（形状收敛 + id 前缀校验）归 scheduler 模块；
     *   - 字段校验（validateScheduledTask，中文错误消息）后规范化落盘；
     *   - 新会话工作区在此处校验（输入校验属接受用户输入的端点）；
     *   - configUpdate=immediate：保存后无需等待次日，下一 tick 即按新配置决策。
     *
     * K1：`ownerSessionId` 由请求体自报并原样保存（全局共享语义），本层不做归属校验。
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
            throw httpError(501, presentationOf(this.host, '定时任务存储不可用', 'Scheduler task store is unavailable'));
        const saved = await store.save(normalizeScheduledTask(task));
        return saved;
    }
    /** 删除定时任务（全局共享：仅凭 taskId 即可删除，不校验会话归属，K1；运行中 run 不受影响，仅解绑引擎引用）。 */
    async schedulerTaskDelete(args) {
        const taskId = String(args?.taskId ?? '');
        if (!taskId)
            throw httpError(400, 'requires taskId');
        const store = this.host.schedulerTaskStore;
        if (!store)
            throw httpError(501, presentationOf(this.host, '定时任务存储不可用', 'Scheduler task store is unavailable'));
        const deleted = await store.delete(taskId);
        if (deleted)
            await this.host.scheduler?.forgetTask(taskId);
        return { deleted };
    }
}
//# sourceMappingURL=scheduler.js.map