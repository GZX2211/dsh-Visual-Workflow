import type { CallerInfo, OrchestratorRuntime, RootAgentLike } from '../orchestrator/runtime.js';
import { type ToolExecLike } from './define-tool.js';
/**
 * 从工具执行上下文派生调用方身份（CallerInfo）。
 * 官方 Session header 事实：子代理会话的 header 携带 `origin: 'subagent'` 与
 * `parentSession`（父会话 id）；根 Agent 会话无这两个字段，其 id 即会话 id。
 * 派生结果供 wf_run_node/wf_finish（仅根 Agent）与 wf_ask（仅子代理）归属校验共用。
 */
export declare function callerOf(exec: ToolExecLike): CallerInfo;
/** 工具层所需宿主能力（宿主 service 的最小结构适配）。 */
export interface WfToolsHost {
    /** 编排运行时（wf_run_node/wf_finish/wf_ask 校验与执行）。 */
    orchestrator: OrchestratorRuntime;
    /** 按会话取根 Agent（wf_ask 以父 root 身份发起官方提问）。 */
    getRootAgent(sessionId: string): RootAgentLike | null;
}
/**
 * 注册四个父代理编排工具（全局层；ctx.tools.register）。
 * 返回 disposer：逐个注销，注销失败尽力而为。
 * 与旧项目注册实现的差异：
 *   - defineTool DSL（本地实现）替代手写 raw JSON Schema；
 *   - wf_run_node 新增 wait/thinking/iterationLimit/retryLimit 扩展参数
 *     （阻塞选择 + 节点级参数透传）；
 *   - 暂停门并入 wf_run_node（无独立 wf_pause 工具）。
 */
export declare function registerWfTools(ctx: {
    get(name: string): unknown;
}, host: WfToolsHost): () => void;
