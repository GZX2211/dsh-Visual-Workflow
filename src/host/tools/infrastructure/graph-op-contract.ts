// src/host/tools/infrastructure/graph-op-contract.ts
//
// 写图契约的**单一事实源**：op 字段形状、节点 data 契约、提交规则、错误码语义、闸门标记语义。
//
// 为什么要独立成工具层基础设施：这些文本被两个工具共同消费——`wf_graph_patch` 的参数层
// 错误消息（模型自我修正的主要通道）与 `wf_org_catalog` 的 rules 段（一处常驻描述无法承载
// 的完整契约）。由任一工具目录反向导出会让依赖方向变脏，因此提升到共享基础设施。
//
// 为什么必须集中且语言与工具描述一致：ops 是自由对象，模型无法从 JSON Schema 推断字段名；
// 同一份契约若在两处各自维护，必然出现「描述说的」与「报错说的」不一致（历史上 connect 的
// 端点字段被猜成 from/to、节点字段被平铺到 op 顶层，都源于契约不可见）。模型可见面统一为
// 英文（与工具 description 同语言），避免同一份上下文里中英混排。
//
// 纯常量模块：无运行时依赖、无状态、无副作用。

/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export const OP_FIELD_SHAPES: Record<string, string> = {
  create_node: "{ op:'create_node', node:{ kind:'agent'|'parent'|'start'|'end'|'pause'|'group'|'proxy'|'file'|'database', id?:string, data?:{...} } } (node fields must live inside node, never flattened onto the op)",
  remove_node: "{ op:'remove_node', nodeId:string, cascade?:boolean }",
  update_node_data: "{ op:'update_node_data', nodeId:string, data:{...} }",
  connect: "{ op:'connect', source:string, target:string, sourceHandle?:'flow-out'|'ctx-out'|'db-out', targetHandle?:'flow-in'|'ctx-in'|'db-in', condition?:{ type:'pass'|'fail'|'content', label?:string } } (the endpoint fields are named source/target; when handles are omitted the flow channel is completed as flow-out -> flow-in)",
  disconnect: "{ op:'disconnect', lineId:string } or { op:'disconnect', key:{ source,target,sourceHandle,targetHandle } }",
  create_group: "{ op:'create_group', groupId:string, label:string, collabPrompt?:string, memberIds?:string[] }",
  set_group_members: "{ op:'set_group_members', groupId:string, memberIds:string[] } (memberIds is required; omitting it does not clear members)",
}

/** 图结构组的全部 op 形状（一段可整体引用的文本）。 */
export const GRAPH_OP_FIELD_TEXT = [
  `create_node ${OP_FIELD_SHAPES.create_node}`,
  `remove_node ${OP_FIELD_SHAPES.remove_node}`,
  `update_node_data ${OP_FIELD_SHAPES.update_node_data}`,
  `connect ${OP_FIELD_SHAPES.connect}`,
  `disconnect ${OP_FIELD_SHAPES.disconnect}`,
  `create_group ${OP_FIELD_SHAPES.create_group}`,
  `set_group_members ${OP_FIELD_SHAPES.set_group_members}`,
].join('; ')

/** 标记组的 op 形状。 */
export const MARK_OP_FIELD_TEXT =
  "{ op:'mark_node', nodeId:string, status:'ok'|'fail' } (marks the CURRENT gate only; one patch carries exactly 1 mark op)"

/**
 * 角色节点（agent / parent）的 data 字段契约。
 * 为什么必须显式写清 presetId：它为空意味着该节点运行期**零工具**（连读写文件都调不到），
 * 而图检查器只以告警提示，不会阻断——这条契约是模型唯一能提前避开该坑的地方。
 */
export const ROLE_NODE_DATA_CONTRACT = [
  "data fields of a role node (kind='agent'|'parent'): ",
  'label (required, human-readable name); ',
  'systemPrompt (required, the complete role and task description for that child agent - not a one-line title); ',
  'presetId (required, taken from a tool combo id or an official preset id; empty means that node runs with zero tools); ',
  'provider + model (copy both columns of the model catalog together: an "org/" prefix inside model belongs to model itself, not to provider; leaving them empty falls back to the host default; values outside the catalog are rejected by the patch); ',
  'reasoning? (reasoning effort); inputSchema? (what this node should receive); outputSchema? (the structure of this node final reply, read by downstream ctx-connected nodes). ',
  'Canvas-owned fields (retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId) cannot be configured through the graph tool: they are ignored when passed on create and preserved on update. ',
].join('')

/** 提交规则：一次补丁怎么组织、哪些形态会被拒绝。 */
export const PATCH_SUBMISSION_RULES = [
  'Submission rules:',
  '1. One patch carries ops from ONE group only (graph structure / mark run state); mixing groups is rejected;',
  '2. A patch is atomic: if any op fails nothing is persisted, and the reply lists every failure in order with its own error code - fix them all and resubmit the whole patch;',
  '3. Ops apply in array order: create nodes first, then connect, within the same patch;',
  '4. Node coordinates are not accepted: position is pure view data and the canvas lays out new nodes automatically;',
  '5. One patch is limited to 200 ops; split larger changes into batches;',
  '6. scope=template changes a workflow template (planning time), scope=instance changes an instance (run time); a scope that does not match the real target type is rejected;',
  '7. Create a new template with create (only with scope=template and the graph group); it is mutually exclusive with expectRevision; passing an existing targetId never overwrites - it is rejected;',
  '8. expectRevision is an optimistic lock: a mismatch is rejected without retry - resubmit against the latest topology;',
  '9. Meta parameters (the organization budget, e.g. nodeMax) are hard guards on graph editing and belong to no op group - an unknown op such as set_meta in a patch is rejected as an argument error.',
].join('\n')

/** 稳定错误码语义（按「该改什么」分组，模型据此选择修正方向）。 */
export const ERROR_CODE_SEMANTICS = [
  'Error-code semantics:',
  '- WF_BAD_ARGS: argument shape / value / size is wrong (including unknown op names and too many ops) - the call arguments are what to fix;',
  '- WF_GRAPH_INVALID: graph semantics are wrong (structural validation or the orchestration checker blocked it, or the failed batch contains a graph-semantics error) - the graph is what to fix; the error text carries repair suggestions;',
  '- WF_PATCH_MIXED_GROUPS: one patch mixed different op groups - split it into separate calls;',
  '- WF_PATCH_CONFLICT: a revision or id conflict (stale expectRevision, or create hitting an existing template id) - never retried automatically;',
  '- WF_ORG_NOT_FOUND: the target template / instance does not exist or is not owned by this session;',
  '- WF_SCOPE_INVALID: scope does not match the real target type;',
  '- WF_MILESTONE_INVALID: the gate marking timing / target / budget is invalid;',
  '- WF_NOT_ROOT: called by a non-parent agent (child agents have no graph privileges).',
].join('\n')

/** 闸门标记语义（mark_node 的适用时机与判定）。 */
export const GATE_MARKING_SEMANTICS = [
  'Gate marking (mark_node) semantics:',
  "1. Only a gate turn makes sense: the current turn must be driven by a proxy node (data.role='milestone') pointing at the parent agent; pure orchestration turns and ordinary execution turns have no gate to mark;",
  '2. The target must be the CURRENT gate: nodeId may be the gate proxy node id or the parent agent node id - they are equivalent (both resolve to the parent agent node);',
  '3. One patch carries exactly 1 mark_node (there is one current gate);',
  "4. status='ok' increments the used count and is rejected at milestoneMax (0 = unlimited); status='fail' does not consume the budget;",
  '5. The reply carries a read-only budget (used / limit / remaining), so you can tell how many marks are left.',
].join('\n')

/**
 * 写图契约全文（`wf_org_catalog` 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，再节点 data 契约，最后错误码语义。
 */
export const PATCH_CONTRACT_TEXT = [
  PATCH_SUBMISSION_RULES,
  '',
  `Graph group op shapes: ${GRAPH_OP_FIELD_TEXT}`,
  `Mark group op shapes: ${MARK_OP_FIELD_TEXT}`,
  '',
  ROLE_NODE_DATA_CONTRACT,
  '',
  ERROR_CODE_SEMANTICS,
].join('\n')

/**
 * 工具描述里的**契约指引**。
 * 两个工具共用同一份字面量：它点名 rules 的键名，如果键名改了，两侧一起失败而不是
 * 「描述指向一个不存在的字段」这种静默漂移。
 */
export const PATCH_CONTRACT_POINTER =
  'Field shapes and submission rules are not repeated here: read rules.patchContract and rules.gateMarking from wf_org_catalog before your first patch.'
