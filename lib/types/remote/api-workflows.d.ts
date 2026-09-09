import { VisualWorkflowApiBase } from './api-base.js';
export declare class VisualWorkflowApiWorkflows extends VisualWorkflowApiBase {
    /**
     * 工作流列表（工作台全局化改版）：sessionId 缺省时返回**全部会话**的工作流
     * 实例（工作台全局面板数据源）；传入时按会话过滤（定时任务检测目标会话
     * 已有实例用）。
     */
    listWorkflows(args: {
        sessionId?: unknown;
    }): Promise<unknown>;
    /**
     * 创建新主会话端点（「开启新会话」一次性动作：从模板创建实例时先新建主会话，
     * 实例绑定该新会话 id）。
     *   - workspacePath 传入时校验存在为目录（resolveWorkspacePath）并作为新会话 cwd；
     *   - workspacePath 缺省时继承创建者会话（sessionId）的 cwd（与定时任务 new-session 一致）；
     *   - cwd 解析不到时省略（官方会话默认工作区）。
     */
    createSession(args: {
        sessionId?: unknown;
        workspacePath?: unknown;
        label?: unknown;
    }): Promise<unknown>;
    getWorkflow(args: {
        sessionId?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    createWorkflow(args: {
        sessionId?: unknown;
        name?: unknown;
        description?: unknown;
    }): Promise<unknown>;
    putWorkflow(args: {
        sessionId?: unknown;
        flow?: unknown;
    }): Promise<unknown>;
    deleteWorkflow(args: {
        sessionId?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    /**
     * 服务列表（工作台全局化改版）：sessionId 缺省时返回**全部会话**的服务实例
     * （工作台全局面板数据源）；传入时按会话过滤（旧单会话面板兼容调用）。
     */
    listServices(args: {
        sessionId?: unknown;
    }): Promise<unknown>;
    getService(args: {
        sessionId?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    putService(args: {
        sessionId?: unknown;
        service?: unknown;
    }): Promise<unknown>;
    deleteService(args: {
        sessionId?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    serviceStart(args: {
        sessionId?: unknown;
        serviceId?: unknown;
    }): Promise<unknown>;
    serviceStop(args: {
        sessionId?: unknown;
        serviceId?: unknown;
    }): Promise<unknown>;
    serviceStatus(args: {
        sessionId?: unknown;
        serviceId?: unknown;
    }): Promise<unknown>;
    private withServiceManager;
    /** 校验可选工作区路径（存在且为目录；空值返回 undefined；异常转 400）。 */
    private checkedWorkspacePath;
}
