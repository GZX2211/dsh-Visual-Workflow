// src/host/tools/infrastructure/graph-op-contract.ts
//
// 写图契约的**单一事实源**：op 字段形状、节点 data 契约、提交规则、错误码语义、闸门标记语义。
//
// 为什么要独立成工具层基础设施：这些文本被两个工具共同消费——`wf_graph_patch` 的参数层
// 错误消息（模型自我修正的主要通道）与 `wf_org_catalog` 的 rules 段（一处常驻描述无法承载
// 的完整契约）。由任一工具目录反向导出会让依赖方向变脏，因此提升到共享基础设施。
//
// 为什么必须是中文且集中：ops 是自由对象，模型无法从 JSON Schema 推断字段名；同一份契约
// 若在两处各自维护，必然出现「描述说的」与「报错说的」不一致（历史上 connect 的端点字段
// 被猜成 from/to、节点字段被平铺到 op 顶层，都源于契约不可见）。
//
// 纯常量模块：无运行时依赖、无状态、无副作用。

/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export const OP_FIELD_SHAPES: Record<string, string> = {
  create_node: "{ op:'create_node', node:{ kind:'agent'|'parent'|'start'|'end'|'pause'|'group'|'proxy'|'file'|'database', id?:string, data?:{...} } }（节点字段必须在 node 里，不能平铺到 op 顶层）",
  remove_node: "{ op:'remove_node', nodeId:string, cascade?:boolean }",
  update_node_data: "{ op:'update_node_data', nodeId:string, data:{...} }",
  connect: "{ op:'connect', source:string, target:string, sourceHandle?:'flow-out'|'ctx-out'|'db-out', targetHandle?:'flow-in'|'ctx-in'|'db-in', condition?:{ type:'pass'|'fail'|'content', label?:string } }（端点字段名是 source/target；handle 省略时按流程通道补全 flow-out→flow-in）",
  disconnect: "{ op:'disconnect', lineId:string } 或 { op:'disconnect', key:{ source,target,sourceHandle,targetHandle } }",
  create_group: "{ op:'create_group', groupId:string, label:string, collabPrompt?:string, memberIds?:string[] }",
  set_group_members: "{ op:'set_group_members', groupId:string, memberIds:string[] }（memberIds 必填，缺省不会清空成员）",
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
].join('；')

/** 标记组的 op 形状。 */
export const MARK_OP_FIELD_TEXT =
  "{ op:'mark_node', nodeId:string, status:'ok'|'fail' }（只标记**当前**闸门，一次补丁只能 1 条）"

/**
 * 角色节点（agent / parent）的 data 字段契约。
 * 为什么必须显式写清 presetId：它为空意味着该节点运行期**零工具**（连读写文件都调不到），
 * 而图检查器只以告警提示，不会阻断——这条契约是模型唯一能提前避开该坑的地方。
 */
export const ROLE_NODE_DATA_CONTRACT = [
  "角色节点（kind='agent'|'parent'）的 data 字段：",
  'label（必填，人类可读名称）；',
  'systemPrompt（必填，该子代理的完整角色与任务说明，不是一句标题）；',
  'presetId（必填，取值来自工具组合的 id 或官方 preset 的 id；为空则该节点运行期没有任何工具）；',
  'provider + model（provider 与 model 必须成对复制模型清单的两列：model 里的「组织/」前缀属于 model 本身，不是 provider；留空退化为宿主默认；清单外的取值会被补丁拒绝）；',
  'reasoning?（思考强度）；inputSchema?（该节点应收到什么）；outputSchema?（该节点最终回复的结构，下游 ctx 连线节点按它读取）。',
  '画布所有的字段（retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId）不可通过改图工具配置：创建时忽略传入值，更新时保留现值。',
].join('')

/** 提交规则：一次补丁怎么组织、哪些形态会被拒绝。 */
export const PATCH_SUBMISSION_RULES = [
  '提交规则：',
  '① 一次补丁只能含一组 op（graph 图结构 / mark 运行状态标记），混组即拒绝；',
  '② 补丁是原子的：任一条 op 失败则整批不落盘，返回按序号列出全部失败项与各自的错误码，修正后整批重新提交；',
  '③ ops 按数组顺序应用：同批里先建节点、再连线；',
  '④ 不接受节点坐标：position 是纯视图数据，新建节点由画布自动布局；',
  '⑤ 单次补丁 op 数上限 200，超限请拆分提交；',
  '⑥ scope=template 改工作流模板（规划期），scope=instance 改实例（运行期）；scope 与目标真实类型不匹配即拒绝；',
  '⑦ 新建模板用 create（仅限 scope=template 且 graph 组），它与 expectRevision 互斥；传入已存在的 targetId 不会覆盖，直接拒绝；',
  '⑧ expectRevision 是乐观锁：不匹配即拒绝且不自动重试，请基于最新拓扑重新提交；',
  '⑨ 元参数（组织预算，如 nodeMax）是约束改图的硬护栏，不属于任何操作组——补丁里出现 set_meta 之类的未知 op 会按入参错误拒绝。',
].join('\n')

/** 稳定错误码语义（按「该改什么」分组，模型据此选择修正方向）。 */
export const ERROR_CODE_SEMANTICS = [
  '错误码语义：',
  '· WF_BAD_ARGS——入参形状 / 取值 / 规模有误（含未知 op 名、op 数超限），要改的是调用参数；',
  '· WF_GRAPH_INVALID——图语义有误（结构校验或编排检查器阻断、批次级失败项里含图语义错误），要改的是图，错误文本带修复建议；',
  '· WF_PATCH_MIXED_GROUPS——同一补丁混用了不同 op 组，拆成多次提交；',
  '· WF_PATCH_CONFLICT——版本或 id 冲突（expectRevision 过期、create 撞上已存在的模板 id），不自动重试；',
  '· WF_ORG_NOT_FOUND——目标模板 / 实例不存在或不属于本会话；',
  '· WF_SCOPE_INVALID——scope 与目标真实类型不匹配；',
  '· WF_MILESTONE_INVALID——闸门标记的时机 / 目标 / 次数预算不合法；',
  '· WF_NOT_ROOT——非父代理调用（子代理没有改图权限）。',
].join('\n')

/** 闸门标记语义（mark_node 的适用时机与判定）。 */
export const GATE_MARKING_SEMANTICS = [
  '闸门标记（mark_node）语义：',
  '① 只在**闸门轮**有意义：本轮必须由指向父代理的虚拟节点（data.role=\'milestone\'）驱动；纯编排轮与普通执行轮都没有可标记的闸门；',
  '② 目标必须是**当前**闸门：nodeId 可写闸门虚拟节点 id 或父代理节点 id，两者等价（都归一到父代理节点）；',
  '③ 一次补丁只能有 1 条 mark_node（闸门同一时刻只有一个）；',
  '④ status=\'ok\' 递增闸门已用次数，达到 milestoneMax 即拒绝（0 = 不限制）；status=\'fail\' 不消耗次数；',
  '⑤ 返回体带只读 budget（闸门已用 / 上限 / 剩余），据此判断还能标记几次。',
].join('\n')

/**
 * 写图契约全文（`wf_org_catalog` 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，再节点 data 契约，最后错误码语义。
 */
export const PATCH_CONTRACT_TEXT = [
  PATCH_SUBMISSION_RULES,
  '',
  `图结构组 op 形状：${GRAPH_OP_FIELD_TEXT}`,
  `标记组 op 形状：${MARK_OP_FIELD_TEXT}`,
  '',
  ROLE_NODE_DATA_CONTRACT,
  '',
  ERROR_CODE_SEMANTICS,
].join('\n')

/**
 * 工具描述里的**契约指引**（中英混排的唯一一处）。
 * 两个工具共用同一份字面量：它点名 rules 的键名，如果键名改了，两侧一起失败而不是
 * 「描述指向一个不存在的字段」这种静默漂移。
 */
export const PATCH_CONTRACT_POINTER =
  'Field shapes, the role-node data contract, submission rules and error-code semantics are NOT repeated here: '
  + 'call wf_org_catalog (omit ids) and read rules.patchContract for the write-patch contract and rules.gateMarking for the milestone-gate rules before your first patch. '
  + 'The full op shapes are also echoed in every parameter-level error message.'
