// src/host/tools/wf-org-catalog/build.ts
//
// wf_org_catalog 的**纯函数装配层**：把工具层已取到的数据组装成索引/详情返回体。
// 不触盘、不读时钟、不读全局——同一入参必同输出（需要外部事实时一律经回调注入）。
//
// 关键契约（用户裁决）：骨架必须自足——不可二次召回的内容（阶段节点、协作组配置、
// 连线、数据节点正文与连接信息）一次性给全，保证「索引 + 多次详情召回」能拼出与
// 工作流资产等价的完整信息；**唯一按需召回的长字段是角色 systemPrompt**，由骨架里的
// 复合 id 指向。
import { nodeParticipatesInFlow } from '../../graph/index.js';
import { labelOf } from '../../orchestrator/index.js';
import { ORG_SOP_DESIGN_METHOD, ORG_SOP_L1_GRAPH_SEMANTICS } from '../../prompts/index.js';
import { PATCH_CONTRACT_TEXT } from '../infrastructure/graph-op-contract.js';
import { CATALOG_LIMITS, ID_CONVENTION, INLINE_ROLE_SEPARATOR, INSTANCE_ID } from './types.js';
/** 索引里的召回指引：目录是候选清单而非全部内容，详情按 ids 召回。 */
export const DETAIL_HINT = 'Index entries are **candidates** only (name / description / version); full content must be recalled by calling this tool again with ids: '
    + '["flow-xxx"] = the workflow asset\'s complete skeleton; ["role-xxx"] = the role asset\'s full systemPrompt; '
    + '["flow-xxx#node-yyy"] = the full systemPrompt of that inline role\'s fixed version. '
    + 'The skeleton already contains stage nodes, group configuration, lines and data-node bodies (those have no second recall path); '
    + 'the only long field recalled on demand is the role systemPrompt. A bad id among ids fails alone and does not block the rest.';
/** 骨架返回体里的提示：角色提示词走复合 id 按需召回；角色版本无法解析时的取舍。 */
export const WORKFLOW_DETAIL_NOTE = 'Role nodes in nodes (kind=agent|parent) omit systemPrompt: recall each one by its composite id from inlineRoles. '
    + 'roleAssetId / roleVersionId are the role asset and version this node is pinned to; when that role version row can no longer be resolved, both fields are omitted (the rest of the skeleton is unaffected).';
/** 实例骨架返回体提示：第 3 层入口 + 孤立节点禁令（口径与资产骨架一致）。 */
export const INSTANCE_DETAIL_NOTE = 'This is the skeleton of the instance running in this session: topology only, no asset content. '
    + 'Role nodes in nodes (kind=agent|parent) omit systemPrompt: recall each one by its instance#<node id> from inlineRoles. '
    + 'schedulable=false marks nodes left on the canvas without a flow line: never dispatch them.';
/**
 * 无活跃实例时的禁令文案（用户裁决逐字定稿）。
 *
 * 为什么返回正文而不是报错/空数组：这里的事实是「规划阶段没有实例可参考」，
 * 文案本身就是护栏——它同时阻断模型另行翻找实例文件（因此不得出现任何路径线索）。
 */
export const INSTANCE_UNAVAILABLE_NOTE = '当前会话没有正在运行的实例：规划阶段不得参考任何实例，请仅基于资产与工作区事实进行规划';
/** 数据库连接里不进模型上下文的密钥字段。 */
const SECRET_CONNECTION_KEYS = ['password'];
/** 数组预算：超限截断并返回是否截断。 */
function clipList(items, limit) {
    return items.length > limit ? { items: items.slice(0, limit), truncated: true } : { items, truncated: false };
}
/** 宽松字符串化（null/undefined → 空串）。 */
function textOf(value) {
    return value === undefined || value === null ? '' : String(value);
}
/** 非空 trim 后字符串（无内容返回 null，便于按需省略字段）。 */
function trimmedOrNull(value) {
    const text = textOf(value).trim();
    return text ? text : null;
}
/** 组装资产索引（第一次调用）。 */
export function buildIndex(input) {
    const workflowEntries = input.workflows.map(workflowAssetEntryOf).filter((entry) => entry.id);
    const roleEntries = input.roles.map(roleAssetEntryOf).filter((entry) => entry.id);
    const comboEntries = input.combos.map(comboEntryOf).filter((entry) => entry.id);
    const presetEntries = input.presets.map(presetEntryOf).filter((entry) => entry.id);
    const modelEntries = input.models.map(modelEntryOf).filter((entry) => entry.provider || entry.model);
    const workflows = clipList(workflowEntries, CATALOG_LIMITS.workflowAssets);
    const roles = clipList(roleEntries, CATALOG_LIMITS.roleAssets);
    const combos = clipList(comboEntries, CATALOG_LIMITS.combos);
    const presets = clipList(presetEntries, CATALOG_LIMITS.presets);
    const models = clipList(modelEntries, CATALOG_LIMITS.models);
    return {
        kind: 'index',
        idConvention: ID_CONVENTION,
        detailHint: DETAIL_HINT,
        combos: combos.items,
        presets: presets.items,
        models: models.items,
        assets: { workflows: workflows.items, roles: roles.items },
        rules: {
            graphSemantics: ORG_SOP_L1_GRAPH_SEMANTICS,
            designMethod: ORG_SOP_DESIGN_METHOD,
            patchContract: PATCH_CONTRACT_TEXT,
        },
        truncated: workflows.truncated
            || roles.truncated
            || combos.truncated
            || presets.truncated
            || models.truncated,
    };
}
function workflowAssetEntryOf(asset) {
    const id = textOf(asset.assetId);
    return {
        id,
        name: trimmedOrNull(asset.name) ?? id,
        description: textOf(asset.description),
        versionId: Number(asset.versionId) || 0,
    };
}
/**
 * 角色资产索引条目。
 * 摘要是「够不够拿来参考」的判据，由资产库在列表查询里 JOIN 当前 Active 版本行产出
 * （systemPrompt 前 60 字 + 截断标记，见 `src/host/assets/role-assets.ts`），此处**原样透传**：
 * 两侧各自截断会让 `…（已截断）` 标记叠加。摘要缺失即空串（不编造职责描述），
 * 完整提示词始终可按 id 召回。
 */
function roleAssetEntryOf(asset) {
    const id = textOf(asset.assetId);
    return {
        id,
        name: trimmedOrNull(asset.name) ?? id,
        kind: asset.kind === 'parent' ? 'parent' : 'agent',
        versionId: Number(asset.versionId) || 0,
        roleAssetType: roleAssetTypeOf(asset.roleAssetType),
        summary: textOf(asset.summary),
    };
}
/**
 * 角色资产类型收窄。
 * 未知值按 `standalone` 处理：与资产模块对「未知 role_asset_type」的降级方向一致
 * （同一事实的两处收窄不得给出不同答案）。
 */
function roleAssetTypeOf(value) {
    if (value === 'inline' || value === 'shared')
        return value;
    return 'standalone';
}
/**
 * 组合条目：工具清单**不截断**——组合 id 是节点 presetId 的唯一取值来源，
 * 截断会让父代理基于残缺工具集选错组合。
 */
function comboEntryOf(combo) {
    return {
        id: textOf(combo.id),
        name: textOf(combo.name),
        tools: Array.isArray(combo.tools) ? combo.tools.map(textOf).filter(Boolean) : [],
        mcpServers: Array.isArray(combo.mcpServers) ? combo.mcpServers.map(textOf).filter(Boolean) : [],
    };
}
function presetEntryOf(preset) {
    const description = textOf(preset.description).trim();
    return {
        id: textOf(preset.id),
        name: textOf(preset.name) || textOf(preset.id),
        ...(description ? { description } : {}),
    };
}
function modelEntryOf(model) {
    const efforts = Array.isArray(model.efforts)
        ? model.efforts
            .map((effort) => ({ id: textOf(effort?.id), name: textOf(effort?.name) || textOf(effort?.id) }))
            .filter((effort) => effort.id)
        : [];
    return {
        provider: textOf(model.provider),
        model: textOf(model.model),
        ...(efforts.length > 0 ? { efforts } : {}),
    };
}
/**
 * 节点 → 角色版本行引用映射。
 * 工作流资产的节点内容由角色版本行 join 而来，引用清单是节点与角色资产之间唯一的
 * 对应关系；同一节点出现多条引用时取首条（AssetStore 按节点唯一写入，多条属脏数据）。
 */
function roleRefMapOf(refs) {
    const map = new Map();
    for (const ref of refs ?? []) {
        const nodeId = textOf(ref?.nodeId).trim();
        const rowId = textOf(ref?.roleVersionId).trim();
        if (nodeId && rowId && !map.has(nodeId))
            map.set(nodeId, rowId);
    }
    return map;
}
/**
 * 骨架节点 / 连线条目（资产与实例**共用**的唯一装配口径）。
 *
 * 为什么必须共用：同一份骨架会经两条通道给出（资产 `flow-*` 与运行实例 `instance`），
 * 各写一套必然让字段取舍与 schedulable 口径漂移——而父代理把两者当作同一种东西来读。
 */
function skeletonOf(input) {
    // schedulable 与运行期编排清单同源（nodeParticipatesInFlow）：只看流程线，ctx/db 线不计，
    // proxy 的流程线归属其主节点。
    const flow = { nodes: input.nodes, lines: input.lines };
    const schedulableOf = (nodeId) => nodeParticipatesInFlow(flow, nodeId);
    return {
        nodes: input.nodes.map((node) => nodeEntryOf(node, input.roleNodeEntryOf, schedulableOf)),
        lines: input.lines.map(lineEntryOf),
    };
}
/** 组装工作流资产骨架（`flow-*` 的返回体）。 */
export function buildWorkflowDetail(asset, roleRefOf) {
    const nodes = (asset.nodes ?? []);
    const lines = (asset.lines ?? []);
    const id = textOf(asset.assetId);
    const refs = roleRefMapOf(asset.roleVersionIds);
    const skeleton = skeletonOf({
        nodes,
        lines,
        roleNodeEntryOf: (node) => {
            const rowId = refs.get(node.id);
            const resolved = rowId && roleRefOf ? roleRefOf(rowId) : null;
            return roleNodeEntry(node, resolved?.assetId ?? undefined, resolved?.versionId);
        },
    });
    return {
        type: 'workflow',
        id,
        assetId: id,
        versionId: Number(asset.versionId) || 0,
        name: trimmedOrNull(asset.name) ?? id,
        description: textOf(asset.description),
        mode: asset.mode === 'mode2' ? 'mode2' : 'mode1',
        ...(asset.meta && Object.keys(asset.meta).length > 0 ? { meta: asset.meta } : {}),
        nodes: skeleton.nodes,
        lines: skeleton.lines,
        inlineRoles: nodes
            .filter((node) => node.kind === 'agent' || node.kind === 'parent')
            .map((node) => `${id}${INLINE_ROLE_SEPARATOR}${node.id}`),
        note: WORKFLOW_DETAIL_NOTE,
    };
}
/**
 * 组装当前运行实例骨架（`instance` 召回的第 2 层）。
 *
 * 与资产骨架的差别只在元数据：实例没有版本，也没有角色资产引用映射（其角色 Prompt 是
 * 内联快照），故 roleNodeEntryOf 不带引用——第 3 层 `instance#<nodeId>` 直接取节点正文。
 *
 * @param flow 当前会话活跃 run 的工作流文档；`null` = 无活跃实例（返回禁令体）。
 */
export function buildInstanceDetail(flow) {
    if (!flow) {
        return { type: 'instance', id: INSTANCE_ID, available: false, message: INSTANCE_UNAVAILABLE_NOTE };
    }
    const nodes = (flow.nodes ?? []);
    const skeleton = skeletonOf({
        nodes,
        lines: (flow.lines ?? []),
        roleNodeEntryOf: (node) => roleNodeEntry(node),
    });
    return {
        type: 'instance',
        id: INSTANCE_ID,
        name: trimmedOrNull(flow.name) ?? flow.id,
        description: textOf(flow.description),
        mode: flow.mode === 'mode2' ? 'mode2' : 'mode1',
        ...(flow.meta && Object.keys(flow.meta).length > 0 ? { meta: flow.meta } : {}),
        nodes: skeleton.nodes,
        lines: skeleton.lines,
        inlineRoles: nodes
            .filter((node) => node.kind === 'agent' || node.kind === 'parent')
            .map((node) => `${INSTANCE_ID}${INLINE_ROLE_SEPARATOR}${node.id}`),
        note: INSTANCE_DETAIL_NOTE,
    };
}
/** 组装角色资产详情（systemPrompt 完整返回，不截断）。 */
export function buildRoleDetail(asset) {
    const id = textOf(asset.assetId);
    const reasoning = trimmedOrNull(asset.reasoning);
    const promptSource = trimmedOrNull(asset.systemPromptSource);
    return {
        type: 'role',
        id,
        assetId: id,
        versionId: Number(asset.versionId) || 0,
        roleAssetType: roleAssetTypeOf(asset.roleAssetType),
        name: trimmedOrNull(asset.name) ?? id,
        kind: asset.kind === 'parent' ? 'parent' : 'agent',
        presetId: trimmedOrNull(asset.presetId),
        provider: textOf(asset.provider),
        model: textOf(asset.model),
        ...(reasoning ? { reasoning } : {}),
        inputSchema: textOf(asset.inputSchema),
        outputSchema: textOf(asset.outputSchema),
        ...(promptSource ? { systemPromptSource: promptSource } : {}),
        systemPrompt: textOf(asset.systemPrompt),
    };
}
/**
 * 组装工作流资产内联角色详情（标明所属工作流与节点，避免多角色召回时混淆）。
 * 内容来自该节点在角色资产里的**固定引用版本**（不是该资产的 Active 版本）。
 */
export function buildInlineRoleDetail(input) {
    const data = input.node.data;
    const reasoning = trimmedOrNull(data.reasoning);
    const promptSource = trimmedOrNull(data.systemPromptSource);
    return {
        type: 'inlineRole',
        id: `${input.containerId}${INLINE_ROLE_SEPARATOR}${input.node.id}`,
        containerId: input.containerId,
        nodeId: input.node.id,
        ...(input.roleAssetId ? { roleAssetId: input.roleAssetId } : {}),
        ...(input.roleVersionId !== undefined ? { roleVersionId: input.roleVersionId } : {}),
        label: textOf(data.label),
        presetId: trimmedOrNull(data.presetId),
        provider: textOf(data.provider),
        model: textOf(data.model),
        ...(reasoning ? { reasoning } : {}),
        inputSchema: textOf(data.inputSchema),
        outputSchema: textOf(data.outputSchema),
        groupId: data.groupId ?? null,
        ...(promptSource ? { systemPromptSource: promptSource } : {}),
        systemPrompt: textOf(data.systemPrompt),
    };
}
/**
 * 数据库连接脱敏：密钥字段替换为占位符，其余字段原样保留（保证资产可复用）。
 * 为什么必须脱敏：连接信息没有二次召回通道，必须一次性给出；而密码一旦进入模型
 * 上下文与对话历史就无法收回。
 */
export function maskConnection(conn) {
    if (!conn || typeof conn !== 'object' || Array.isArray(conn))
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(conn)) {
        out[key] = SECRET_CONNECTION_KEYS.includes(key) ? '**' : value;
    }
    return out;
}
/** 角色节点条目（不可召回字段给全；systemPrompt 走复合 id 按需召回）。 */
function roleNodeEntry(node, roleAssetId, roleVersionId) {
    const data = node.data;
    const reasoning = trimmedOrNull(data.reasoning);
    const promptSource = trimmedOrNull(data.systemPromptSource);
    return {
        id: node.id,
        kind: node.kind,
        label: labelOf(node),
        presetId: trimmedOrNull(data.presetId),
        provider: textOf(data.provider),
        model: textOf(data.model),
        ...(reasoning ? { reasoning } : {}),
        inputSchema: textOf(data.inputSchema),
        outputSchema: textOf(data.outputSchema),
        ...(promptSource ? { systemPromptSource: promptSource } : {}),
        groupId: data.groupId ?? null,
        ...(roleAssetId ? { roleAssetId } : {}),
        ...(roleVersionId !== undefined ? { roleVersionId } : {}),
    };
}
/** 节点条目（按 kind 判别；字段取舍见 CatalogNodeEntry 的说明）。 */
function nodeEntryOf(node, roleNodeEntryOf, schedulableOf) {
    switch (node.kind) {
        case 'start':
        case 'end':
        case 'pause': {
            const entry = { id: node.id, kind: node.kind, label: labelOf(node) };
            return entry;
        }
        // 只有 agent 是「可调度单元」：parent 是编排者本人，其执行身份由运行期指令给出，
        // 不标注 schedulable（否则会诱导父代理把「调度自己」理解成一次节点派发）。
        case 'agent':
            return { ...roleNodeEntryOf(node), schedulable: schedulableOf(node.id) };
        case 'parent':
            return roleNodeEntryOf(node);
        case 'proxy': {
            const entry = {
                id: node.id,
                kind: 'proxy',
                label: textOf(node.data?.label) || node.proxySourceId,
                proxySourceId: node.proxySourceId,
            };
            return entry;
        }
        case 'group': {
            const entry = {
                id: node.id,
                kind: 'group',
                label: labelOf(node),
                collabPrompt: textOf(node.data.collabPrompt),
                memberIds: Array.isArray(node.data.memberIds) ? node.data.memberIds.map(textOf) : [],
                // 协作组卡片是包裹层，不是调度目标（用户裁决 2026-10）：恒为 false，避免诱导父代理对
                // 组 id 调用 wf_run_node（会被运行时拒绝）。成员节点各自带自己的 schedulable。
                schedulable: false,
            };
            return entry;
        }
        case 'file': {
            const data = node.data;
            const entry = {
                id: node.id,
                kind: 'file',
                label: labelOf(node),
                fileKind: data.fileKind === 'file' ? 'file' : 'text',
                ...(data.content !== undefined ? { content: textOf(data.content) } : {}),
                ...(data.fileName !== undefined ? { fileName: textOf(data.fileName) } : {}),
                ...(data.managedPath !== undefined ? { managedPath: textOf(data.managedPath) } : {}),
                ...(Array.isArray(data.files)
                    ? { files: data.files.map((file) => ({ fileName: textOf(file.fileName), managedPath: textOf(file.managedPath) })) }
                    : {}),
            };
            return entry;
        }
        case 'database': {
            const data = node.data;
            const conn = maskConnection(data.conn);
            const entry = {
                id: node.id,
                kind: 'database',
                label: labelOf(node),
                description: textOf(data.description),
                dbType: data.dbType === 'server' ? 'server' : 'local',
                dbKind: textOf(data.dbKind),
                ...(data.localPath !== undefined ? { localPath: textOf(data.localPath) } : {}),
                ...(conn ? { conn } : {}),
                ...(trimmedOrNull(data.vectorSource) ? { vectorSource: textOf(data.vectorSource) } : {}),
                ...(data.vectorOptions ? { vectorOptions: data.vectorOptions } : {}),
            };
            return entry;
        }
    }
}
/** 连线条目（条件分支语义是编排事实，必须给全）。 */
function lineEntryOf(line) {
    const condition = line.condition?.type;
    return {
        id: line.id,
        source: line.source,
        target: line.target,
        sourceHandle: line.sourceHandle,
        targetHandle: line.targetHandle,
        ...(condition
            ? { condition: { type: condition, ...(line.condition?.label ? { label: line.condition.label } : {}) } }
            : {}),
    };
}
//# sourceMappingURL=build.js.map