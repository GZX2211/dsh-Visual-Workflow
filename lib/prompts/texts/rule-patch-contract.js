// src/host/prompts/texts/rule-patch-contract.ts
//
// 规则文本 · **写图契约**（提交规则 / op 字段形状 / 角色节点 data 契约）
// 注入位置：wf_org_catalog 索引返回的 rules.patchContract（唯一注入通道）。
// 其中 OP_FIELD_SHAPES 另被 wf_graph_patch 的参数层错误消息逐条引用（模型自我修正的主要通道）。
// 语言：中文（与其它按需返回的规则文本一致）；JSON 字段名 / 取值 / 工具名保留原样。
/** 单个补丁的 op 数上限（与 wf_graph_patch 的整体护栏同源；组织预算的 patchOpsMax 可能更小）。 */
export const PATCH_OPS_MAX = 200;
/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export const OP_FIELD_SHAPES = {
    create_node: "{ op:'create_node', node:{ kind:'agent'|'parent'|'start'|'end'|'pause'|'group'|'proxy'|'task'|'database', id?:string, data?:{...} } }（节点字段必须写在 node 内，不得平铺到 op 上）",
    remove_node: "{ op:'remove_node', nodeId:string, cascade?:boolean }（cascade 缺省 true：引用它的 proxy 节点一并删除；关联连线始终删除）",
    update_node_data: "{ op:'update_node_data', nodeId:string, data:{...} }",
    connect: "{ op:'connect', source:string, target:string, sourceHandle?:'flow-out'|'ctx-out'|'db-out', targetHandle?:'flow-in'|'ctx-in'|'db-in', condition?:{ type:'pass'|'fail'|'content', label?:string } }（端点字段名为 source/target；省略 handle 时按 flow-out -> flow-in 补全流程通道，ctx/db 通道必须显式写 handle）",
    disconnect: "{ op:'disconnect', lineId:string } 或 { op:'disconnect', key:{ source,target,sourceHandle,targetHandle } }",
    create_group: "{ op:'create_group', groupId:string, label?:string, collabPrompt?:string, memberIds?:string[] }（label 缺省取 groupId）",
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
    '优先复用已有角色：只写 roleAssetId（取值 role-* / flow-*#<节点id> / instance#<节点id>），系统自动带入 systemPrompt / presetId / provider / model / reasoning / inputSchema / outputSchema，显式 data 字段覆盖带入值，并在节点上登记 data.sourceAssetId；无合适角色时才手写下面的配置；',
    'label：人类可读名称；使用 roleAssetId 时取角色名，手写时缺省回退节点 id；',
    'systemPrompt：未使用 roleAssetId 时必须填写该子代理完整的角色职责提示词；',
    'presetId：未使用 roleAssetId 时必须填写，取自工具组合 id 或官方 preset id；为空表示该节点运行期零工具（连读写文件都做不到）；',
    'provider + model：未使用 roleAssetId 时结合任务复杂度按需填写；必须成对复制模型目录中的两列——model 内的 "org/" 前缀属于 model 本身，不属于 provider；留空则回退宿主默认；',
    'reasoning?（思考强度，结合任务复杂度填写合适值）；inputSchema?（输入契约：该节点应当收到什么）；',
    'outputSchema?（输出契约：该节点最终回复必须如何组织；新建 agent 节点省略时写入默认契约文本，parent 不参与节点交接，update 省略即保持现值）。',
].join('\n');
/** 提交规则：一次补丁怎么组织、哪些形态会被拒绝。 */
export const PATCH_SUBMISSION_RULES = [
    '提交规则：',
    '1. 补丁是原子的：任一 op 失败则全部不落盘——须一次性修完所有报错并整批重发；',
    '2. op 按数组顺序生效：同一批补丁内先建节点、再连线；',
    `3. 单个补丁最多 ${PATCH_OPS_MAX} 个 op；更大的改动拆成多批提交；`,
    '4. scope=template 改工作流模板（规划期），scope=instance 改实例（运行期）；',
    '5. create 新建模板（仅 scope=template），与 expectRevision 互斥；',
    '6. expectRevision 是乐观锁：不匹配即拒绝且不自动重试——请基于最新拓扑重发；',
].join('\n');
/**
 * 写图契约全文（wf_org_catalog 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，最后角色节点 data 契约。
 */
export const PATCH_CONTRACT_TEXT = [
    PATCH_SUBMISSION_RULES,
    '',
    `图操作字段形状：${GRAPH_OP_FIELD_TEXT}`,
    '',
    ROLE_NODE_DATA_CONTRACT,
].join('\n');
//# sourceMappingURL=rule-patch-contract.js.map