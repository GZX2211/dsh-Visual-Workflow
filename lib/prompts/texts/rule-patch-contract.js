// src/host/prompts/texts/rule-patch-contract.ts
//
// 规则文本 · **写图契约**（op 字段形状 / 节点 data 契约 / 提交规则 / 稳定错误码语义）
// 注入位置：wf_org_catalog 索引返回的 rules.patchContract；同时被 wf_graph_patch 的参数层
// 错误消息逐条引用（模型自我修正的主要通道）。
// 语言：中文（与其它按需返回的规则文本一致）；JSON 字段名 / 取值 / 工具名 / 错误码保留原样。
/** 单个补丁的 op 数上限（与 wf_graph_patch 的整体护栏同源）。 */
export const PATCH_OPS_MAX = 200;
/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export const OP_FIELD_SHAPES = {
    create_node: "{ op:'create_node', node:{ kind:'agent'|'parent'|'start'|'end'|'pause'|'group'|'proxy'|'file'|'database', id?:string, data?:{...} } }（节点字段必须写在 node 内，不得平铺到 op 上）",
    remove_node: "{ op:'remove_node', nodeId:string, cascade?:boolean }",
    update_node_data: "{ op:'update_node_data', nodeId:string, data:{...} }",
    connect: "{ op:'connect', source:string, target:string, sourceHandle?:'flow-out'|'ctx-out'|'db-out', targetHandle?:'flow-in'|'ctx-in'|'db-in', condition?:{ type:'pass'|'fail'|'content', label?:string } }（端点字段名为 source/target；省略 handle 时按 flow-out -> flow-in 补全流程通道）",
    disconnect: "{ op:'disconnect', lineId:string } 或 { op:'disconnect', key:{ source,target,sourceHandle,targetHandle } }",
    create_group: "{ op:'create_group', groupId:string, label:string, collabPrompt?:string, memberIds?:string[] }",
    set_group_members: "{ op:'set_group_members', groupId:string, memberIds:string[] }（memberIds 必填；省略它不会清空成员）",
};
/** 图结构组的全部 op 形状（一段可整体引用的文本）。 */
export const GRAPH_OP_FIELD_TEXT = [
    `create_node ${OP_FIELD_SHAPES.create_node}`,
    `remove_node ${OP_FIELD_SHAPES.remove_node}`,
    `update_node_data ${OP_FIELD_SHAPES.update_node_data}`,
    `connect ${OP_FIELD_SHAPES.connect}`,
    `disconnect ${OP_FIELD_SHAPES.disconnect}`,
    `create_group ${OP_FIELD_SHAPES.create_group}`,
    `set_group_members ${OP_FIELD_SHAPES.set_group_members}`,
].join('；');
/**
 * 角色节点（agent / parent）的 data 字段契约。
 * 为什么必须显式写清 presetId：它为空意味着该节点运行期**零工具**（连读写文件都调不到），
 * 而图检查器只以告警提示，不会阻断——这条契约是模型唯一能提前避开该坑的地方。
 */
export const ROLE_NODE_DATA_CONTRACT = [
    "角色节点（kind='agent'|'parent'）的 data 字段：",
    '复用角色（首选，避免每次搬运大段提示词）：只写 roleAssetId，取值来自 wf_org_catalog——role-*（角色资产）、flow-*#<节点id>（工作流资产内联角色）、instance#<节点id>（当前运行实例的内联角色）；系统自动带入 systemPrompt / presetId / provider / model / reasoning / inputSchema / outputSchema，显式 data 字段覆盖带入值，并在节点上登记 data.sourceAssetId；只有无合适角色时才手写下面的完整配置；',
    'label（必填，人类可读名称；使用 roleAssetId 时缺省取角色名）；',
    'systemPrompt（未使用 roleAssetId 时必填，该子代理完整的角色与任务描述——不是一句话标题）；',
    'presetId（未使用 roleAssetId 时必填，取自工具组合 id 或官方 preset id；为空表示该节点运行期零工具）；',
    'provider + model（未使用 roleAssetId 时按需提供；必须成对复制模型目录中的两列：model 内的 "org/" 前缀属于 model 本身，不属于 provider；留空则回退宿主默认；目录之外的取值会被补丁拒绝）；',
    'reasoning?（思考强度）；inputSchema?（输入契约：该节点应当收到什么）；outputSchema?（输出契约：该节点最终回复必须如何组织；下游节点会自动收到上游产出，无需 ctx 连线；此处省略即使用默认契约文本）。',
    '画布自有字段（retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId）不在此配置；sourceAssetId 由 roleAssetId 引用自动登记。',
].join('');
/** 提交规则：一次补丁怎么组织、哪些形态会被拒绝。 */
export const PATCH_SUBMISSION_RULES = [
    '提交规则：',
    '1. 补丁是原子的：任一 op 失败则全部不落盘，返回体按顺序列出每条失败及其错误码——请一次性修完并整批重发；',
    '2. op 按数组顺序生效：同一批补丁内先建节点、再连线；',
    '3. 不接受节点坐标：位置是纯视图数据，画布会自动布局新节点；',
    `4. 单个补丁最多 ${PATCH_OPS_MAX} 个 op；更大的改动请拆成多批提交；`,
    '5. scope=template 改工作流模板（规划期），scope=instance 改实例（运行期）；scope 与真实目标类型不符会被拒绝；',
    '6. 用 create 新建模板（仅 scope=template）；它与 expectRevision 互斥；传入已存在的 targetId 不会覆盖——直接拒绝；',
    '7. expectRevision 是乐观锁：不匹配即拒绝且不重试——请基于最新拓扑重发；',
    '8. 元参数（组织预算，如 nodeMax）是图编辑的硬护栏，不属于任何 op；set_meta 这类参数会按未知 op 拒绝。',
].join('\n');
/** 稳定错误码语义（按「该改什么」分组，模型据此选择修正方向）。 */
export const ERROR_CODE_SEMANTICS = [
    '错误码语义：',
    '- WF_BAD_ARGS：参数形状 / 取值 / 规模错误（含未知 op 名与 op 数超限）——要修正的是调用参数；',
    '- WF_GRAPH_INVALID：图语义错误（结构校验或编排检查器拦截，或失败批次中含图语义错误）——要修正的是图本身；错误文本带修复建议；',
    '- 一次补丁报出多条失败时，聚合错误码随失败项：全部为参数层错误才是 WF_BAD_ARGS；只要含一条图语义错误即 WF_GRAPH_INVALID；',
    '- WF_PATCH_CONFLICT：revision 或 id 冲突（expectRevision 过期，或 create 撞上已存在的模板 id）——绝不自动重试；',
    '- WF_ORG_NOT_FOUND：目标模板 / 实例不存在或不属于本会话；',
    '- WF_SCOPE_INVALID：scope 与真实目标类型不符；',
    '- WF_NOT_ROOT：由非父代理调用（子代理没有改图权限）。',
].join('\n');
/**
 * 写图契约全文（wf_org_catalog 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，再节点 data 契约，最后错误码语义。
 */
export const PATCH_CONTRACT_TEXT = [
    PATCH_SUBMISSION_RULES,
    '',
    `图操作字段形状：${GRAPH_OP_FIELD_TEXT}`,
    '',
    ROLE_NODE_DATA_CONTRACT,
    '',
    ERROR_CODE_SEMANTICS,
].join('\n');
//# sourceMappingURL=rule-patch-contract.js.map