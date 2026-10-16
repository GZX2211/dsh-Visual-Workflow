/** 单个补丁的 op 数上限（与 wf_graph_patch 的整体护栏同源）。 */
export declare const PATCH_OPS_MAX = 200;
/**
 * 各图操作的**最小字段契约**（逐条模式）：键为 op 名，值为该 op 的形状说明。
 * 被参数层错误消息逐条引用，保证「报错说的」与「目录里写的」永远一致。
 */
export declare const OP_FIELD_SHAPES: Record<string, string>;
/** 图结构组的全部 op 形状（一段可整体引用的文本）。 */
export declare const GRAPH_OP_FIELD_TEXT: string;
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
/**
 * 写图契约全文（wf_org_catalog 的 rules.patchContract 直接引用这一段）。
 * 顺序即阅读顺序：先怎么提交，再各 op 形状，再节点 data 契约，最后错误码语义。
 */
export declare const PATCH_CONTRACT_TEXT: string;
