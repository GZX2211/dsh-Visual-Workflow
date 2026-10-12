import type { CatalogIndex, CatalogInlineRoleDetail, CatalogInstanceDetail, CatalogInstanceUnavailable, CatalogModelSource, CatalogPresetSource, CatalogRoleDetail, CatalogWorkflowDetail } from './types.js';
import type { RoleAssetDetail, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../../shared/asset-types.js';
import type { RoleNode, WorkflowDocument } from '../../shared/graph-model.js';
/** 索引里的召回指引：目录是候选清单而非全部内容，详情按 ids 召回。 */
export declare const DETAIL_HINT: string;
/** 骨架返回体里的提示：角色提示词走复合 id 按需召回；角色版本无法解析时的取舍。 */
export declare const WORKFLOW_DETAIL_NOTE: string;
/** 实例骨架返回体提示：第 3 层入口 + 孤立节点禁令（口径与资产骨架一致）。 */
export declare const INSTANCE_DETAIL_NOTE: string;
/**
 * 无活跃实例时的禁令文案（用户裁决逐字定稿）。
 *
 * 为什么返回正文而不是报错/空数组：这里的事实是「规划阶段没有实例可参考」，
 * 文案本身就是护栏——它同时阻断模型另行翻找实例文件（因此不得出现任何路径线索）。
 */
export declare const INSTANCE_UNAVAILABLE_NOTE = "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u6B63\u5728\u8FD0\u884C\u7684\u5B9E\u4F8B\uFF1A\u89C4\u5212\u9636\u6BB5\u4E0D\u5F97\u53C2\u8003\u4EFB\u4F55\u5B9E\u4F8B\uFF0C\u8BF7\u4EC5\u57FA\u4E8E\u8D44\u4EA7\u4E0E\u5DE5\u4F5C\u533A\u4E8B\u5B9E\u8FDB\u884C\u89C4\u5212";
/**
 * 节点 → 角色资产引用的解析结果。
 * `assetId` 为 null 表示角色版本行存在但无法回溯到资产 id（历史数据残缺）：
 * 此时只给 versionId，让模型至少知道「这个节点钉的是哪一版」。
 */
export interface ResolvedRoleRef {
    assetId: string | null;
    versionId: number;
}
/** 组装资产索引（第一次调用）。 */
export declare function buildIndex(input: {
    workflows: WorkflowAssetSummary[];
    roles: RoleAssetSummary[];
    combos: Array<Record<string, unknown>>;
    presets: CatalogPresetSource[];
    models: CatalogModelSource[];
}): CatalogIndex;
/** 组装工作流资产骨架（`flow-*` 的返回体）。 */
export declare function buildWorkflowDetail(asset: WorkflowAssetDetail, roleRefOf?: (roleRowId: string) => ResolvedRoleRef | null): CatalogWorkflowDetail;
/**
 * 组装当前运行实例骨架（`instance` 召回的第 2 层）。
 *
 * 与资产骨架的差别只在元数据：实例没有版本，也没有角色资产引用映射（其角色 Prompt 是
 * 内联快照），故 roleNodeEntryOf 不带引用——第 3 层 `instance#<nodeId>` 直接取节点正文。
 *
 * @param flow 当前会话活跃 run 的工作流文档；`null` = 无活跃实例（返回禁令体）。
 */
export declare function buildInstanceDetail(flow: WorkflowDocument | null): CatalogInstanceDetail | CatalogInstanceUnavailable;
/** 组装角色资产详情（systemPrompt 完整返回，不截断）。 */
export declare function buildRoleDetail(asset: RoleAssetDetail): CatalogRoleDetail;
/**
 * 组装工作流资产内联角色详情（标明所属工作流与节点，避免多角色召回时混淆）。
 * 内容来自该节点在角色资产里的**固定引用版本**（不是该资产的 Active 版本）。
 */
export declare function buildInlineRoleDetail(input: {
    containerId: string;
    node: RoleNode;
    roleAssetId?: string;
    roleVersionId?: number;
}): CatalogInlineRoleDetail;
/**
 * 数据库连接脱敏：密钥字段替换为占位符，其余字段原样保留（保证资产可复用）。
 * 为什么必须脱敏：连接信息没有二次召回通道，必须一次性给出；而密码一旦进入模型
 * 上下文与对话历史就无法收回。
 */
export declare function maskConnection(conn: unknown): Record<string, unknown> | undefined;
