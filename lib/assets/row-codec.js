// src/host/assets/row-codec.ts
//
// 行 ⇄ 领域对象的纯转换层：SQLite 行值只在此处转成 RoleTemplate / RoleNode /
// 详情契约形状，反向也在此处归一化成可写列值。
//
// 为什么集中一处：角色节点的字段映射（data.label ↔ name 等）是双向的，保存与
// 重建各写一份必然漂移；两侧共用同一份映射，才能保证「存的正是读回来的」。
import { toInteger, toJsonText, toNullableInteger, toNullableText, toOptionalText, toText } from './role-check.js';
/** 角色检索上下文 = id + name + kind + system_prompt 前 60 字。 */
export function roleRetrievalContext(assetId, fields) {
    return `${assetId} ${fields.name} ${fields.kind} ${fields.systemPrompt.slice(0, 60)}`;
}
/** 角色模版（晋升源）→ 内容字段。 */
export function roleFieldsFromTemplate(role) {
    return {
        kind: role.kind,
        name: role.name,
        systemPrompt: role.systemPrompt,
        provider: role.provider,
        model: role.model,
        reasoning: role.reasoning ?? '',
        presetId: role.presetId ?? null,
        retryLimit: role.retryLimit,
        reactLimit: role.reactLimit ?? null,
        inputSchema: toOptionalText(role.inputSchema),
        outputSchema: toOptionalText(role.outputSchema),
        systemPromptSource: role.systemPromptSource ?? null,
        injectSystemPrompt: role.injectSystemPrompt !== false,
        injectToolSections: role.injectToolSections !== false,
        promptFilePath: role.promptFilePath ?? null,
    };
}
/** 角色节点（工作流内联）→ 内容字段（name ← data.label）。 */
export function roleFieldsFromNode(node) {
    return {
        kind: node.kind,
        name: node.data.label,
        systemPrompt: node.data.systemPrompt,
        provider: node.data.provider,
        model: node.data.model,
        reasoning: node.data.reasoning ?? '',
        presetId: node.data.presetId ?? null,
        retryLimit: node.data.retryLimit,
        reactLimit: node.data.reactLimit ?? null,
        inputSchema: toOptionalText(node.data.inputSchema),
        outputSchema: toOptionalText(node.data.outputSchema),
        systemPromptSource: node.data.systemPromptSource ?? null,
        injectSystemPrompt: node.data.injectSystemPrompt !== false,
        injectToolSections: node.data.injectToolSections !== false,
        promptFilePath: node.data.promptFilePath ?? null,
    };
}
/** 是否角色节点（父/子代理共用 RoleNode 形状）。 */
export function isRoleNode(node) {
    return node.kind === 'parent' || node.kind === 'agent';
}
/** 内容字段是否全等（去重与「未变更」判定共用同一口径）。 */
export function sameRoleFields(left, right) {
    return (left.kind === right.kind &&
        left.name === right.name &&
        left.systemPrompt === right.systemPrompt &&
        left.provider === right.provider &&
        left.model === right.model &&
        left.reasoning === right.reasoning &&
        left.presetId === right.presetId &&
        left.retryLimit === right.retryLimit &&
        left.reactLimit === right.reactLimit &&
        left.inputSchema === right.inputSchema &&
        left.outputSchema === right.outputSchema &&
        left.systemPromptSource === right.systemPromptSource &&
        left.injectSystemPrompt === right.injectSystemPrompt &&
        left.injectToolSections === right.injectToolSections &&
        left.promptFilePath === right.promptFilePath);
}
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
export function roleRowValues(assetId, versionId, fields, options) {
    return {
        id: options.rowId,
        versionId,
        assetId,
        kind: fields.kind,
        name: fields.name,
        systemPrompt: fields.systemPrompt,
        provider: fields.provider,
        model: fields.model,
        reasoning: fields.reasoning ?? '',
        presetId: fields.presetId ?? '',
        retryLimit: Math.max(0, fields.retryLimit),
        reactLimit: fields.reactLimit,
        inputSchema: toOptionalText(fields.inputSchema),
        outputSchema: toOptionalText(fields.outputSchema),
        systemPromptSource: fields.systemPromptSource,
        injectSystemPrompt: fields.injectSystemPrompt ? 1 : 0,
        injectToolSections: fields.injectToolSections ? 1 : 0,
        promptFilePath: fields.promptFilePath,
        retrievalContext: roleRetrievalContext(assetId, fields),
        roleAssetType: options.roleAssetType,
        referenceStatus: 'unused',
        // 新版本行的引用从零开始：引用统计是「被哪些工作流版本引用」，不可跨版本继承
        referenceWorkflowIds: '[]',
        source: options.source,
        sourceTemplateId: options.sourceTemplateId,
        sourceFingerprint: options.sourceFingerprint,
        createdAt: options.createdAt,
        updatedAt: options.updatedAt,
    };
}
/** 角色内容字段 → RoleNode.data（节点壳重建；kind 由调用方保留）。 */
export function roleFieldsToNodeData(fields, extra) {
    return {
        label: fields.name,
        systemPrompt: fields.systemPrompt,
        provider: fields.provider,
        model: fields.model,
        reasoning: fields.reasoning,
        presetId: fields.presetId,
        retryLimit: fields.retryLimit,
        reactLimit: fields.reactLimit,
        inputSchema: fields.inputSchema ?? undefined,
        outputSchema: fields.outputSchema ?? undefined,
        systemPromptSource: fields.systemPromptSource ?? undefined,
        injectSystemPrompt: fields.injectSystemPrompt,
        injectToolSections: fields.injectToolSections,
        promptFilePath: fields.promptFilePath ?? undefined,
        groupId: extra.groupId ?? null,
        sourceAssetId: extra.sourceAssetId,
    };
}
/** 版本行 → 行值（更新策略字段时复用；内容列保持不变）。 */
export function roleRowToFields(row) {
    return {
        kind: row.kind === 'parent' ? 'parent' : 'agent',
        name: toText(row.name),
        systemPrompt: toText(row.system_prompt),
        provider: toText(row.provider),
        model: toText(row.model),
        reasoning: toText(row.reasoning),
        presetId: toNullableText(row.preset_id),
        retryLimit: toInteger(row.retry_limit, 0),
        reactLimit: toNullableInteger(row.react_limit),
        inputSchema: toNullableText(row.input_schema),
        outputSchema: toNullableText(row.output_schema),
        systemPromptSource: toNullableText(row.system_prompt_source),
        injectSystemPrompt: toInteger(row.inject_system_prompt, 1) !== 0,
        injectToolSections: toInteger(row.inject_tool_sections, 1) !== 0,
        promptFilePath: toNullableText(row.prompt_file_path),
    };
}
/** 版本行 → 完整领域对象（JSON 列损坏时由调用方决定跳过或抛错）。 */
export function roleRowToAssetRow(row) {
    return {
        ...roleRowToFields(row),
        id: toText(row.id),
        versionId: toInteger(row.version_id, 0),
        assetId: toText(row.asset_id),
        roleAssetType: toRoleAssetType(row.role_asset_type),
        referenceWorkflowIds: parseReferenceIds(row.reference_workflow_ids),
        referenceStatus: row.reference_status === 'used' ? 'used' : 'unused',
        source: row.source === 'agent' ? 'agent' : 'human',
        sourceTemplateId: toNullableText(row.source_template_id),
        sourceFingerprint: toNullableText(row.source_fingerprint),
        createdAt: toInteger(row.created_at, 0),
        updatedAt: toInteger(row.updated_at, 0),
    };
}
/** Active 行 → 领域对象。 */
export function roleActiveRow(row) {
    return {
        assetId: toText(row.asset_id),
        versionId: toInteger(row.version_id, 0),
        name: toText(row.name),
        retrievalContext: toText(row.retrieval_context),
        sourceTemplateId: toNullableText(row.source_template_id),
        sourceFingerprint: toNullableText(row.source_fingerprint),
        updatedAt: toInteger(row.updated_at, 0),
    };
}
/** 角色资产类型读取（未知取值按 standalone 处理：旧数据不得因新枚举而整体不可读）。 */
export function toRoleAssetType(value) {
    return value === 'inline' || value === 'shared' ? value : 'standalone';
}
/**
 * 引用列表解析：JSON 非法即视为空列表。
 * 为什么读路径不因它抛错：引用统计是缓存，损坏时降级为空只丢失展示信息；
 * 严格性留给工作流节点壳与版本映射（见 workflow-assets.ts）。
 */
export function parseReferenceIds(value) {
    if (typeof value !== 'string' || value === '')
        return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((item) => typeof item === 'string');
    }
    catch {
        return [];
    }
}
/** 严格 JSON 解析（nodes/lines/meta/role_version_ids 等结构列；损坏即抛错）。 */
export function parseJsonStrict(value, label) {
    if (typeof value !== 'string' || value === '') {
        throw new Error(`${label} 为空或不是 JSON 文本：资产行已损坏`);
    }
    try {
        return JSON.parse(value);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} JSON 解析失败：${detail}`);
    }
}
//# sourceMappingURL=row-codec.js.map