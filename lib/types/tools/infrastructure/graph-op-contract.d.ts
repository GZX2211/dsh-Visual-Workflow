/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export declare const OP_FIELD_SHAPES: Record<string, string>;
/** 图结构组的全部 op 形状（一段可整体引用的文本）。 */
export declare const GRAPH_OP_FIELD_TEXT: string;
/** 标记组的 op 形状。 */
export declare const MARK_OP_FIELD_TEXT = "{ op:'mark_node', nodeId:string, status:'ok'|'fail' } (marks the CURRENT gate only; one patch carries exactly 1 mark op)";
/**
 * 角色节点（agent / parent）的 data 字段契约。
 * 为什么必须显式写清 presetId：它为空意味着该节点运行期**零工具**（连读写文件都调不到），
 * 而图检查器只以告警提示，不会阻断——这条契约是模型唯一能提前避开该坑的地方。
 */
export declare const ROLE_NODE_DATA_CONTRACT: string;
/** 提交规则：一次补丁怎么组织、哪些形态会被拒绝。 */
export declare const PATCH_SUBMISSION_RULES: string;
/** 稳定错误码语义（按「该改什么」分组，模型据此选择修正方向）。 */
export declare const ERROR_CODE_SEMANTICS: string;
/** 闸门标记语义（mark_node 的适用时机与判定）。 */
export declare const GATE_MARKING_SEMANTICS: string;
/**
 * 写图契约全文（`wf_org_catalog` 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，再节点 data 契约，最后错误码语义。
 */
export declare const PATCH_CONTRACT_TEXT: string;
/**
 * 工具描述里的**契约指引**。
 * 两个工具共用同一份字面量：它点名 rules 的键名，如果键名改了，两侧一起失败而不是
 * 「描述指向一个不存在的字段」这种静默漂移。
 */
export declare const PATCH_CONTRACT_POINTER = "Field shapes and submission rules are not repeated here: read rules.patchContract and rules.gateMarking from wf_org_catalog before your first patch.";
