// src/host/tools/wf-org-catalog.ts
//
// wf_org_catalog 工具注册（自主编排方案 §4.1）：父代理的「人才市场 + 现有资产」只读勘察。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 参数归一化 + 目录组装 + 预算化截断」；
//   - 数据来源全部经宿主缝（FlowStore / 工具开关 / preset 与模型目录 / 当前画布 / 活跃 run），
//     不做任何写操作、不产生副作用（幂等、零副作用、不依赖运行态——有 run 时顺带刷新空闲基准）；
//   - 返回体**强预算化**（≤8KB 设计目标）：只给 id/name/摘要，角色提示词正文仅在
//     detail.roleId 定向请求时返回（且截断），避免一次勘察吃掉大量上下文预算。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用），≤120 tokens。
import { WF_ORG_CATALOG, RESERVED_TRANSPORT_TOOL, CHILD_AGENT_HIDDEN_TOOLS } from '../shared/protocol.js';
import { defineTool } from './define-tool.js';
import { textRender } from './text-render.js';
import { callerOf } from './wf-tools.js';
import { WfError } from '../orchestrator/seams.js';
import { executableUnitCount, groupCount, maxGroupMembers, orgUsageOf } from '../graph/org-meta-usage.js';
import { effectiveOrgMeta, metaOfDocument, normalizeOrgMeta, orgBudgetOf } from '../graph/org-meta.js';
import { labelOf } from '../orchestrator/helpers.js';
/** 预算化上限（返回体 ≤8KB 的设计目标；超出即截断并在返回体标注 truncated）。 */
export const CATALOG_LIMITS = {
    /** 角色条目上限。 */
    roles: 60,
    /** 组合条目上限。 */
    combos: 30,
    /** preset 条目上限。 */
    presets: 40,
    /** 模板条目上限。 */
    templates: 40,
    /** 数据源条目上限。 */
    dataSources: 40,
    /** 工具清单条目上限（available/disabled 各自）。 */
    tools: 120,
    /** 单条摘要文本上限（字符）。 */
    summary: 200,
    /** 角色提示词正文上限（仅 detail 定向请求时返回）。 */
    prompt: 4000,
    /** 模板拓扑摘要的节点/连线上限。 */
    topology: 60,
};
/** 文本截断（超限追加省略标记，供模型感知「还有更多」）。 */
export function clip(value, limit) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}…（已截断）` : text;
}
/** 数组预算：超限截断并返回是否截断。 */
function clipList(items, limit) {
    return items.length > limit ? { items: items.slice(0, limit), truncated: true } : { items, truncated: false };
}
/** 数据源条目（画布上可复用的文件/数据库节点）。 */
function dataSourcesOf(flow) {
    const out = [];
    for (const node of (flow?.nodes ?? [])) {
        if (node.kind === 'file') {
            const data = node.data;
            const summary = data.fileKind === 'file'
                ? `受管文件：${clip(data.fileName || data.managedPath || ((Array.isArray(data.files) ? data.files.length : 0) + ' 个文件'), CATALOG_LIMITS.summary)}`
                : `文本内容 ${String(data.content ?? '').length} 字`;
            out.push({ nodeId: node.id, kind: 'file', label: labelOf(node), summary });
            continue;
        }
        if (node.kind === 'database') {
            const data = node.data;
            const summary = data.dbType === 'server'
                ? `服务器 ${String(data.dbKind ?? '')}（只读查询）`
                : `本地 ${String(data.dbKind ?? 'sqlite')}：${clip(data.localPath ?? '', CATALOG_LIMITS.summary)}`;
            out.push({ nodeId: node.id, kind: 'database', label: labelOf(node), summary });
        }
    }
    return out;
}
/** 拓扑摘要（templateId 定向勘察时返回，供父代理复用既有编排）。 */
export function topologySummaryOf(flow) {
    const nodes = (flow.nodes ?? []);
    const lines = flow.lines ?? [];
    const nodeClip = clipList(nodes, CATALOG_LIMITS.topology);
    const lineClip = clipList(lines, CATALOG_LIMITS.topology);
    return {
        nodeCount: nodes.length,
        lineCount: lines.length,
        nodes: nodeClip.items.map((node) => ({
            id: node.id,
            kind: node.kind,
            label: node.kind === 'proxy' ? `→ ${node.proxySourceId}` : labelOf(node),
            ...(node.kind === 'agent' || node.kind === 'parent' ? { groupId: node.data.groupId ?? null } : {}),
        })),
        lines: lineClip.items.map((line) => ({
            id: line.id,
            source: line.source,
            target: line.target,
            sourceHandle: line.sourceHandle,
            targetHandle: line.targetHandle,
            ...(line.condition?.type ? { condition: line.condition.type } : {}),
        })),
        truncated: nodeClip.truncated || lineClip.truncated,
    };
}
/** 运行摘要（仅 includeRuns 时返回；本轮预留字段，评估阶段启用）。 */
function runSummaryOf(runs) {
    const run = runs[0];
    if (!run)
        return null;
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    return {
        id: String(run.id ?? ''),
        status: String(run.status ?? ''),
        startedAt: String(run.startedAt ?? ''),
        nodeOk: nodes.filter((node) => node?.status === 'ok').length,
        nodeFail: nodes.filter((node) => node?.status === 'fail').length,
    };
}
/** 组装目录（导出供单测直接断言，无需起工具注册表）。 */
export async function buildOrgCatalog(host, sessionId, options) {
    // 开关现状：先跨进程刷新（别的 dsh 进程可能刚改过 tool-switches.json），再取快照，
    // 否则报告给父代理的 available/disabled 会是过期数据。
    await host.toolSwitches.ensureFresh?.();
    const disabled = host.toolSwitches.currentDisabled();
    const activeRun = host.activeRunOf?.(sessionId) ?? null;
    // 双保险（方案 §5.1）：勘察期间父代理在干活 → 刷新空闲基准，避免长勘察被看护误停
    if (activeRun)
        host.touchRun?.(sessionId);
    // 目标文档：显式 templateId → 该工作流模板；否则当前活跃 run 的实例；再否则本会话最近实例
    let flow = null;
    let template = null;
    if (options.templateId) {
        template = await host.store.getFlowTemplate(options.templateId);
        if (!template) {
            throw new WfError(`工作流模板不存在：${options.templateId}`, 'WF_ORG_NOT_FOUND');
        }
    }
    else if (activeRun && host.currentResolvedFlowOf) {
        // 运行中：以「运行事实源」口径读当前画布（与编排器 currentResolvedFlow 同源）
        flow = await host.currentResolvedFlowOf(sessionId).catch(() => null);
    }
    if (!template && !flow) {
        // 无激活运行：回退本会话最近实例（规划期勘察同样可用）
        const workflows = await host.store.listWorkflows(sessionId);
        flow = workflows[0] ?? null;
    }
    const catalogDoc = (template ?? flow);
    const roles = await host.store.listTemplates('role');
    const combos = await host.store.listToolCombos();
    const presets = (await host.listPresets?.().catch(() => [])) ?? [];
    const allTools = (await host.listTools?.().catch(() => [])) ?? [];
    const templates = await host.store.listFlowTemplates();
    const meta = effectiveOrgMeta(metaOfDocument(catalogDoc));
    const usage = orgUsageOf(catalogDoc, {
        milestoneUsed: Math.max(0, Math.floor(Number(host.milestoneUsedOf?.(sessionId)) || 0)),
    });
    const budget = orgBudgetOf(meta, usage);
    const roleItems = roles.map((role) => ({
        id: String(role.id ?? ''),
        name: String(role.name ?? ''),
        kind: role.kind === 'parent' ? 'parent' : 'agent',
        tools: Array.isArray(role.tools) ? role.tools.map(String).slice(0, 40) : null,
        model: `${String(role.provider ?? '')}/${String(role.model ?? '')}`,
        summary: clip(role.systemPrompt ?? role.description ?? '', CATALOG_LIMITS.summary),
    })).filter((role) => role.id);
    const combosItems = combos.map((combo) => ({
        id: String(combo.id ?? ''),
        name: String(combo.name ?? ''),
        tools: Array.isArray(combo.tools) ? combo.tools.map(String).slice(0, 40) : [],
        mcpServers: Array.isArray(combo.mcpServers) ? combo.mcpServers.map(String).slice(0, 20) : [],
    })).filter((combo) => combo.id);
    const presetItems = presets.map((preset) => ({ id: String(preset.id ?? ''), name: String(preset.name ?? preset.id ?? '') }));
    const templateItems = templates.map((item) => ({
        id: item.id,
        name: item.name ?? item.id,
        mode: item.mode,
        nodeCount: (item.nodes ?? []).length,
        updatedAt: item.updatedAt ?? null,
    }));
    const availableTools = allTools
        .map((tool) => tool.name)
        .filter((name) => name && name !== RESERVED_TRANSPORT_TOOL && !CHILD_AGENT_HIDDEN_TOOLS.includes(name));
    const roleClip = clipList(roleItems, CATALOG_LIMITS.roles);
    const comboClip = clipList(combosItems, CATALOG_LIMITS.combos);
    const presetClip = clipList(presetItems, CATALOG_LIMITS.presets);
    const templateClip = clipList(templateItems, CATALOG_LIMITS.templates);
    const dataSourceClip = clipList(dataSourcesOf(flow), CATALOG_LIMITS.dataSources);
    const toolClip = clipList(availableTools, CATALOG_LIMITS.tools);
    const disabledClip = clipList([...disabled], CATALOG_LIMITS.tools);
    const out = {
        roles: roleClip.items,
        combos: comboClip.items,
        tools: {
            available: toolClip.items,
            disabled: disabledClip.items,
        },
        presets: presetClip.items,
        dataSources: dataSourceClip.items,
        templates: templateClip.items,
        limits: budget,
        // 规模口径与预算一起给出，父代理据此判断「还能加几个节点」
        scale: {
            executableNodes: executableUnitCount(catalogDoc?.nodes),
            groups: groupCount(catalogDoc?.nodes),
            maxGroupMembers: maxGroupMembers(catalogDoc?.nodes),
        },
        truncated: roleClip.truncated || comboClip.truncated || presetClip.truncated
            || templateClip.truncated || dataSourceClip.truncated || toolClip.truncated || disabledClip.truncated,
    };
    if (catalogDoc) {
        out.topology = topologySummaryOf(catalogDoc);
    }
    if (options.detailRoleId) {
        const role = roles.find((item) => String(item.id ?? '') === options.detailRoleId);
        out.rolePrompt = role
            ? { id: String(role.id ?? ''), systemPrompt: clip(role.systemPrompt ?? '', CATALOG_LIMITS.prompt) }
            : null;
    }
    if (options.includeRuns && flow) {
        const runs = await host.store.listRuns(flow.id).catch(() => []);
        out.recentRun = runSummaryOf(Array.isArray(runs) ? runs : []);
    }
    return out;
}
/**
 * 注册 wf_org_catalog（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfOrgCatalog(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_org_catalog');
    }
    const def = defineTool({
        name: WF_ORG_CATALOG,
        description: 'Read-only survey of the organization assets available for planning: role templates, tool combos, enabled/disabled tools, agent presets, reusable data nodes on the canvas, workflow templates, and the effective org budget (limits). ' +
            'Call before planning or patching an organization so you allocate roles within budget. ' +
            'Idempotent and side-effect free; returns a budgeted summary (ids/names only) — pass detail.roleId to read one role prompt, templateId to read one workflow topology. ' +
            'Only the parent agent may call this; child agents are rejected (WF_NOT_ROOT).',
        parameters: {
            templateId: { type: 'string', description: 'Optional workflow template id: return that template topology summary (nodes/lines/scale) instead of only the global catalog.' },
            includeRuns: { type: 'boolean', description: 'Optional: attach the most recent run summary (node ok/fail counts) for the current instance. Default false.' },
            detailRoleId: { type: 'string', description: 'Optional role template id: attach its full system prompt (truncated) for reuse.' },
        },
        output: {
            schema: { type: 'object', additionalProperties: true, description: 'Budgeted catalog: roles/combos/tools/presets/dataSources/templates/limits/scale (+optional topology/rolePrompt/recentRun).' },
            render: textRender,
        },
        async execute(args, exec) {
            const caller = callerOf(exec);
            if (caller.isChild)
                throw new WfError('子代理无法调用 wf_org_catalog（仅当前会话主 Agent 可勘察组织资产）', 'WF_NOT_ROOT');
            if (!caller.sessionId)
                throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER');
            const raw = (args ?? {});
            return buildOrgCatalog(host, caller.sessionId, {
                ...(String(raw.templateId ?? '').trim() ? { templateId: String(raw.templateId).trim() } : {}),
                ...(raw.includeRuns === true ? { includeRuns: true } : {}),
                ...(String(raw.detailRoleId ?? '').trim() ? { detailRoleId: String(raw.detailRoleId).trim() } : {}),
            });
        },
    });
    return tools.register(def);
}
//# sourceMappingURL=wf-org-catalog.js.map