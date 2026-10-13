// src/host/tools/infrastructure/caller.ts
//
// 工具层共享基础设施：调用方身份派生（callerOf）与工具层宿主能力最小缝（WfToolsHost）。
//
// 为什么单独成文件：四个编排工具（wf_run_node / wf_run_node_wait / wf_finish / wf_ask）
// 与 wf_ask_agent / wf_org_catalog / wf_graph_patch / wf_db_query 都要做调用方归属校验，
// 共享逻辑不得留在任何一个具体 Tool 目录（否则形成 Tool → Tool 的反向依赖）。
//
// 职责边界：只做纯身份派生与类型契约，不含任何业务执行语义。

import type { CallerInfo, OrchestratorRuntime, RootAgentLike } from '../../orchestrator/index.js'
import type { PropertySpec, ToolExecLike } from './define-tool.js'

/** Both scheduling and finishing carry the same one-attempt parent review protocol. */
export const taskReviewsParameter: PropertySpec = {
  type: "array", description: "One bounded parent task review per settled attempt; execution completion alone is not business acceptance.",
  items: { type: "object", additionalProperties: false, properties: {
    nodeId: { type: "string", required: true }, runId: { type: "string", required: true },
    childId: { type: "string", required: true }, attempt: { type: "integer", required: true },
    status: { type: "string", required: true, enum: ["accepted", "needs-input", "failed"] },
    reason: { type: "string", required: true, description: "Brief evidence against the node task; requests for data are needs-input, not accepted." },
  } },
}

/**
 * 从工具执行上下文派生调用方身份（CallerInfo）。
 * 官方 Session header 事实：子代理会话的 header 携带 `origin: 'subagent'` 与
 * `parentSession`（父会话 id）；根 Agent 会话无这两个字段，其 id 即会话 id。
 * 派生结果供 wf_run_node/wf_finish（仅根 Agent）与 wf_ask（仅子代理）归属校验共用。
 */
export function callerOf(exec: ToolExecLike): CallerInfo {
  const agent = exec?.agent as { id?: unknown; session?: { header?: Record<string, unknown> } } | null | undefined
  const header = agent?.session?.header ?? {}
  const isChild = header?.origin === 'subagent' || header?.parentSession !== undefined
  const sessionId = isChild
    ? String(header?.parentSession ?? '')
    : String(agent?.id ?? header?.id ?? '')
  return { isChild, sessionId }
}

/**
 * 工具层所需宿主能力（宿主 service 的最小结构适配；index.ts 装配，单测 fake）。
 * 各工具按需使用其中的子集：编排四工具只读 orchestrator；wf_ask 另需 getRootAgent；
 * wf_experience 的宿主缝在编排器与根 Agent 之外还需 assets（见其 WfExperienceHost）。
 */
export interface WfToolsHost {
  /** 编排运行时（wf_run_node/wf_finish/wf_ask 校验与执行）。 */
  orchestrator: OrchestratorRuntime
  /** 按会话取根 Agent（wf_ask 以父 root 身份发起官方提问）。 */
  getRootAgent(sessionId: string): RootAgentLike | null
}
