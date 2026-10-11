import { VisualWorkflowApiBase } from './boundary.js';
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
export declare class SchedulerEndpoints extends VisualWorkflowApiBase {
    /** 定时任务列表（任务 + 引擎运行态视图）。全局共享：不按会话过滤（K1）。 */
    schedulerTasks(): Promise<unknown>;
    /**
     * 保存定时任务（新建/更新统一）：
     *   - 请求体 → 任务实体（形状收敛 + id 前缀校验）归 scheduler 模块；
     *   - 字段校验（validateScheduledTask，中文错误消息）后规范化落盘；
     *   - 新会话工作区在此处校验（输入校验属接受用户输入的端点）；
     *   - configUpdate=immediate：保存后无需等待次日，下一 tick 即按新配置决策。
     *
     * K1：`ownerSessionId` 由请求体自报并原样保存（全局共享语义），本层不做归属校验。
     */
    schedulerTaskPut(args: {
        task?: unknown;
    }): Promise<unknown>;
    /** 删除定时任务（全局共享：仅凭 taskId 即可删除，不校验会话归属，K1；运行中 run 不受影响，仅解绑引擎引用）。 */
    schedulerTaskDelete(args: {
        taskId?: unknown;
    }): Promise<unknown>;
}
