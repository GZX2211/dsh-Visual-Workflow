import type { CatalogIndex, CatalogInlineRoleDetail, CatalogModelSource, CatalogPresetSource, CatalogRoleDetail, CatalogWorkflowDetail } from './types.js';
import type { RoleAssetDetail, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../../shared/asset-types.js';
import type { RoleNode } from '../../shared/graph-model.js';
/** 索引里的召回指引：目录是候选清单而非全部内容，详情按 ids 召回。 */
export declare const DETAIL_HINT: string;
/** 骨架返回体里的提示：角色提示词走复合 id 按需召回；角色版本无法解析时的取舍。 */
export declare const WORKFLOW_DETAIL_NOTE: string;
/** 文本截断（空白压缩 + 超限标注，供角色摘要等短字段使用）。 */
export declare function clip(value: unknown, limit: number): string;
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
