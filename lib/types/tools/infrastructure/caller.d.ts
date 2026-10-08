import type { CallerInfo, OrchestratorRuntime, RootAgentLike } from '../../orchestrator/index.js';
import type { ToolExecLike } from './define-tool.js';
/**
 * 从工具执行上下文派生调用方身份（CallerInfo）。
 * 官方 Session header 事实：子代理会话的 header 携带 `origin: 'subagent'` 与
 * `parentSession`（父会话 id）；根 Agent 会话无这两个字段，其 id 即会话 id。
 * 派生结果供 wf_run_node/wf_finish（仅根 Agent）与 wf_ask（仅子代理）归属校验共用。
 */
export declare function callerOf(exec: ToolExecLike): CallerInfo;
/**
 * 派生经验域所需的调用方身份（内联结构：命名本体在 experience 域，工具层不另起一份）。
 * 子代理的 childId 取自身会话 id（`exec.agent.id`）：经验主体解析要靠它定位该子代理所属
 * 的运行，父代理没有这一层身份，故省略。
 */
export declare function experienceCallerOf(exec: ToolExecLike): {
    isChild: boolean;
    sessionId: string;
    childId?: string;
};
/**
 * 工具层所需宿主能力（宿主 service 的最小结构适配；index.ts 装配，单测 fake）。
 * 各工具按需使用其中的子集：编排四工具只读 orchestrator；wf_ask 另需 getRootAgent；
 * 经验两工具所需的能力缝另立（主体解析与持久化归 domain 层，不由本文件承担）。
 */
export interface WfToolsHost {
    /** 编排运行时（wf_run_node/wf_finish/wf_ask 校验与执行）。 */
    orchestrator: OrchestratorRuntime;
    /** 按会话取根 Agent（wf_ask 以父 root 身份发起官方提问）。 */
    getRootAgent(sessionId: string): RootAgentLike | null;
}
