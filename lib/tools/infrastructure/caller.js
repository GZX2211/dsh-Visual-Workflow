// src/host/tools/infrastructure/caller.ts
//
// 工具层共享基础设施：调用方身份派生（callerOf）与工具层宿主能力最小缝（WfToolsHost）。
//
// 为什么单独成文件：四个编排工具（wf_run_node / wf_run_node_wait / wf_finish / wf_ask）
// 与 wf_ask_agent / wf_org_catalog / wf_graph_patch / wf_db_query 都要做调用方归属校验，
// 共享逻辑不得留在任何一个具体 Tool 目录（否则形成 Tool → Tool 的反向依赖）。
//
// 职责边界：只做纯身份派生与类型契约，不含任何业务执行语义。
/**
 * 从工具执行上下文派生调用方身份（CallerInfo）。
 * 官方 Session header 事实：子代理会话的 header 携带 `origin: 'subagent'` 与
 * `parentSession`（父会话 id）；根 Agent 会话无这两个字段，其 id 即会话 id。
 * 派生结果供 wf_run_node/wf_finish（仅根 Agent）与 wf_ask（仅子代理）归属校验共用。
 */
export function callerOf(exec) {
    const agent = exec?.agent;
    const header = agent?.session?.header ?? {};
    const isChild = header?.origin === 'subagent' || header?.parentSession !== undefined;
    const sessionId = isChild
        ? String(header?.parentSession ?? '')
        : String(agent?.id ?? header?.id ?? '');
    return { isChild, sessionId };
}
//# sourceMappingURL=caller.js.map