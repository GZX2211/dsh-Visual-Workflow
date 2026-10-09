// src/host/tools/wf-org-catalog/types.ts
//
// wf_org_catalog 的返回契约与 ID 约定（纯类型 + 常量）。
//
// 为什么单独成文件：本工具采用「两次调用」模型——不传 ids 返回资产索引，传 ids 返回
// 逐条详情。两份返回体的字段形状是模型消费的稳定契约，与 ID 前缀/复合键判据一样集中
// 在此，避免「组装实现」与「参数描述」两处漂移。
//
// 语义边界（用户裁决）：本工具只召回**资产**（模版的晋升形态，带版本控制），不召回模版
// ——模版是可随意修改的草稿，不构成可参考的组织配置事实。
// ---------------------------------------------------------------------------
// ID 约定（索引会原样返回给模型，模型据此构造后续 ids）
// ---------------------------------------------------------------------------
/** 工作流资产 id 前缀：可召回完整骨架。 */
export const WORKFLOW_ID_PREFIX = 'flow-';
/** 角色资产 id 前缀：可召回完整 systemPrompt。 */
export const ROLE_ID_PREFIX = 'role-';
/** 工作流资产内联角色复合键分隔符：`<工作流资产 id>#<节点 id>`。 */
export const INLINE_ROLE_SEPARATOR = '#';
/** ID 约定文本（判据本体；索引与错误提示共用同一份）。 */
export const ID_CONVENTION = {
    workflow: `${WORKFLOW_ID_PREFIX}* = 工作流资产 → 完整骨架（阶段节点 / 角色与协作组 / 连线 / 数据节点正文）`,
    role: `${ROLE_ID_PREFIX}* = 角色资产 → 完整 systemPrompt 及其映射信息`,
    inlineRole: `${WORKFLOW_ID_PREFIX}xxx${INLINE_ROLE_SEPARATOR}<节点 id> = 工作流资产内联角色 → 该节点固定引用版本的完整 systemPrompt`,
};
/** 条目上限与摘要口径（超限截断并置 truncated，不做静默丢弃）。 */
export const CATALOG_LIMITS = {
    /** 角色资产条目上限。 */
    roleAssets: 60,
    /** 工作流资产条目上限。 */
    workflowAssets: 40,
    /** 组合条目上限。 */
    combos: 30,
    /** 官方 preset 条目上限。 */
    presets: 40,
    /** 模型条目上限。 */
    models: 60,
    /** 角色摘要字数：只够判断职责，不替代完整提示词召回。 */
    roleSummary: 60,
    /** 单次详情召回的 id 上限：超限拒绝并提示分批，避免一次拉爆上下文。 */
    detailIds: 20,
};
//# sourceMappingURL=types.js.map