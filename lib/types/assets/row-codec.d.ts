import type { GraphNode, RoleNode } from '../shared/graph-model.js';
import type { RoleTemplate } from '../shared/template-types.js';
import type { RoleAssetKind, RoleAssetType } from '../shared/asset-types.js';
import type { DbRow } from './db.js';
/** 角色资产版本行的内容字段（不含统计缓存与审计列，便于整组比较）。 */
export interface RoleContentFields {
    kind: RoleAssetKind;
    name: string;
    systemPrompt: string;
    provider: string;
    model: string;
    reasoning: string;
    presetId: string | null;
    retryLimit: number;
    reactLimit: number | null;
    inputSchema: string | null;
    outputSchema: string | null;
    systemPromptSource: string | null;
    injectSystemPrompt: boolean;
    injectToolSections: boolean;
    promptFilePath: string | null;
}
/** 引用统计的规范化结果（reference_status 与数组长度恒一致）。 */
export interface ReferenceStats {
    referenceWorkflowIds: string[];
    referenceStatus: 'unused' | 'used';
}
/**
 * 角色资产版本行：内容列不可变，统计列（role_asset_type / reference_* / updated_at）
 * 由写路径在原行上刷新。
 */
export interface RoleAssetRow extends RoleContentFields {
    id: string;
    versionId: number;
    assetId: string;
    roleAssetType: RoleAssetType;
    referenceWorkflowIds: string[];
    referenceStatus: 'unused' | 'used';
    source: 'human' | 'agent';
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    createdAt: number;
    updatedAt: number;
}
/** 角色资产 Active 行（活性判据 + Active 版本指针）。 */
export interface RoleAssetActiveRow {
    assetId: string;
    versionId: number;
    name: string;
    retrievalContext: string;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    updatedAt: number;
}
/** 角色版本行的可写列值（插入/更新共用一份形状）。 */
export interface RoleVersionRowValues {
    id: string;
    versionId: number;
    assetId: string;
    kind: RoleAssetKind;
    name: string;
    systemPrompt: string;
    provider: string;
    model: string;
    reasoning: string;
    presetId: string | null;
    retryLimit: number;
    reactLimit: number | null;
    inputSchema: string | null;
    outputSchema: string | null;
    systemPromptSource: string | null;
    injectSystemPrompt: number;
    injectToolSections: number;
    promptFilePath: string | null;
    retrievalContext: string | null;
    roleAssetType: RoleAssetType;
    referenceStatus: 'unused' | 'used';
    referenceWorkflowIds: string;
    source: 'human' | 'agent';
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    createdAt: number;
    updatedAt: number;
}
/** 角色检索上下文 = id + name + kind + system_prompt 前 60 字。 */
export declare function roleRetrievalContext(assetId: string, fields: RoleContentFields): string;
/** 角色模版（晋升源）→ 内容字段。 */
export declare function roleFieldsFromTemplate(role: RoleTemplate): RoleContentFields;
/** 角色节点（工作流内联）→ 内容字段（name ← data.label）。 */
export declare function roleFieldsFromNode(node: RoleNode): RoleContentFields;
/** 是否角色节点（父/子代理共用 RoleNode 形状）。 */
export declare function isRoleNode(node: GraphNode): node is RoleNode;
/** 内容字段是否全等（去重与「未变更」判定共用同一口径）。 */
export declare function sameRoleFields(left: RoleContentFields, right: RoleContentFields): boolean;
/**
 * 内容字段 → 行值（retry_limit 有 CHECK >= 0，负值回落 0）。
 * 三个「文本必填」列（reasoning / preset_id / system_prompt）在 DDL 里声明为 NOT NULL
 * 且有默认空串：节点可选字段缺省时必须写成空串而非 null，否则会撞 NOT NULL 约束；
 * 读回时统一还原成 null（见 toNullableText），可选语义由往返保证，不由存储细节泄漏。
 *
 * input_schema / output_schema 是**可空自由文本**列（交接契约说明，不做结构校验）：
 * 缺省与空白一律落 NULL，与读侧 toNullableText 同口径（再走一遍 toOptionalText 是写入边界的兜底，
 * 防止绕过 roleFieldsFrom* 的调用方把空串直接写进列）。
 */
export declare function roleRowValues(assetId: string, versionId: number, fields: RoleContentFields, options: {
    rowId: string;
    roleAssetType: RoleAssetType;
    source: 'human' | 'agent';
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    createdAt: number;
    updatedAt: number;
}): RoleVersionRowValues;
/** 角色内容字段 → RoleNode.data（节点壳重建；kind 由调用方保留）。 */
export declare function roleFieldsToNodeData(fields: RoleContentFields, extra: {
    groupId?: string | null;
    sourceAssetId?: string;
}): RoleNode['data'];
/** 版本行 → 行值（更新策略字段时复用；内容列保持不变）。 */
export declare function roleRowToFields(row: DbRow): RoleContentFields;
/** 版本行 → 完整领域对象（JSON 列损坏时由调用方决定跳过或抛错）。 */
export declare function roleRowToAssetRow(row: DbRow): RoleAssetRow;
/** Active 行 → 领域对象。 */
export declare function roleActiveRow(row: DbRow): RoleAssetActiveRow;
/** 角色资产类型读取（未知取值按 standalone 处理：旧数据不得因新枚举而整体不可读）。 */
export declare function toRoleAssetType(value: unknown): RoleAssetType;
/**
 * 引用列表解析：JSON 非法即视为空列表。
 * 为什么读路径不因它抛错：引用统计是缓存，损坏时降级为空只丢失展示信息；
 * 严格性留给工作流节点壳与版本映射（见 workflow-assets.ts）。
 */
export declare function parseReferenceIds(value: unknown): string[];
/** 严格 JSON 解析（nodes/lines/meta/role_version_ids 等结构列；损坏即抛错）。 */
export declare function parseJsonStrict(value: unknown, label: string): unknown;
