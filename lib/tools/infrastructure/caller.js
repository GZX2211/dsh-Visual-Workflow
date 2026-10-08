// src/host/tools/infrastructure/caller.ts
//
// 工具层共享基础设施：调用方身份派生（callerOf / experienceCallerOf）与工具层宿主能力最小缝（WfToolsHost）。
//
// 为什么单独成文件：四个编排工具（wf_run_node / wf_run_node_wait / wf_finish / wf_ask）
// 与 wf_ask_agent / wf_org_catalog / wf_graph_patch / wf_db_query / 经验两工具都要做调用方
// 归属校验，共享逻辑不得留在任何一个具体 Tool 目录（否则形成 Tool → Tool 的反向依赖）。
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
/**
 * 派生经验域所需的调用方身份（内联结构：命名本体在 experience 域，工具层不另起一份）。
 * 子代理的 childId 取自身会话 id（`exec.agent.id`）：经验主体解析要靠它定位该子代理所属
 * 的运行，父代理没有这一层身份，故省略。
 */
export function experienceCallerOf(exec) {
    const caller = callerOf(exec);
    const childId = caller.isChild ? String(exec?.agent?.id ?? '').trim() : '';
    return childId ? { isChild: true, sessionId: caller.sessionId, childId } : { isChild: caller.isChild, sessionId: caller.sessionId };
}
//# sourceMappingURL=caller.js.map