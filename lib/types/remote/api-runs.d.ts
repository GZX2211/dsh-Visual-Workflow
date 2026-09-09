import { VisualWorkflowApiCatalog } from './api-catalog.js';
export declare class VisualWorkflowApiRuns extends VisualWorkflowApiCatalog {
    /**
     * 启动运行（工作台全局化改版）：运行唯一逻辑 = 运行当前实例——存在可恢复断点
     * （暂停/中断）时自动续跑，否则全新启动；运行会话 = 实例绑定的会话
     * （run.sessionId === instance.sessionId，不再支持运行期新建会话——「开启新会话」
     * 只是创建实例时的一次性动作，见 createSession 端点）。
     */
    run(args: {
        sessionId?: unknown;
        flowId?: unknown;
    }): Promise<unknown>;
    /** 运行状态轮询：内存快照优先，终态（内存已释放）回退磁盘历史。会话归属校验。 */
    runStatus(args: {
        sessionId?: unknown;
        runId?: unknown;
    }): Promise<unknown>;
    /**
     * 活跃 run 列表（工作台全局化改版）：sessionId 缺省时返回**全部会话**的活跃
     * run（工作台全局面板实例列表状态徽标用；running/paused 保留锁）；传入时按
     * 会话过滤（旧单会话面板兼容调用）。
     */
    activeRuns(args: {
        sessionId?: unknown;
    }): Promise<unknown>;
    runStop(args: {
        sessionId?: unknown;
        runId?: unknown;
    }): Promise<unknown>;
    runHistory(args: {
        sessionId?: unknown;
        flowId?: unknown;
    }): Promise<unknown>;
    /** 断点续跑（历史面板「恢复」入口；runId 缺省取该工作流最近可恢复记录）。 */
    runResume(args: {
        sessionId?: unknown;
        flowId?: unknown;
        runId?: unknown;
    }): Promise<unknown>;
    /** 连接测试（本地/服务器驱动均可；返回可展示消息）。 */
    dbTest(args: {
        node?: unknown;
    }): Promise<unknown>;
    /** 表结构预览（只读）。 */
    dbSchema(args: {
        node?: unknown;
    }): Promise<unknown>;
    /**
     * 检索预览：命中索引直接检索；索引缺失或 rebuild=true 时先构建（本地库）。
     * 嵌入不可用时索引自动落 BM25（结果标注 source）。
     */
    dbSearchPreview(args: {
        dataId?: unknown;
        query?: unknown;
        topK?: unknown;
        node?: unknown;
        rebuild?: unknown;
    }): Promise<unknown>;
    exportWorkflow(args: {
        sessionId?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    importWorkflow(args: {
        json?: unknown;
        conflictMode?: unknown;
    }): Promise<unknown>;
    exportAgentTemplate(args: {
        id?: unknown;
    }): Promise<unknown>;
    importAgentTemplate(args: {
        json?: unknown;
        conflictMode?: unknown;
    }): Promise<unknown>;
}
