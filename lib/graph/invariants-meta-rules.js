// src/host/graph/invariants-meta-rules.ts
//
// 图质量规则（自主编排方案 §6.2 规则表）第三期：**元参数与命名**维度——命名约定、
// 角色名重复、元参数硬护栏（节点/组/人数/并行分支/单轮 op 上限）。
// 硬护栏本体复用 org-meta-limits.ts（单一职责，避免与 P1 写图工具重复实现）；
// 已用量口径复用 org-meta-usage.ts；并行分支口径经 dag.ts 的最长路径分层计算。
// 纯函数：不读时钟/随机源，不改写入参。
import { computeFlowLayers, maxLayerWidth } from './dag.js';
import { metaLimitIssues } from './org-meta-limits.js';
import { orgUsageOf } from './org-meta-usage.js';
/** 名称规范化：去空白 + 转小写（判重与命名约定共用）。 */
function normalizeLabel(label) {
    return String(label ?? '').replace(/\s+/g, '').toLowerCase();
}
/** a) 角色名重复（warning；服务「最少子代理数」目标）。 */
export function ruleDuplicateRoleLabel({ flow }) {
    const groups = new Map();
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'agent' && node.kind !== 'parent')
            continue;
        const key = normalizeLabel(node.data.label);
        if (!key)
            continue;
        groups.set(key, [...(groups.get(key) ?? []), node.id]);
    }
    const issues = [];
    for (const [key, ids] of groups) {
        if (ids.length < 2)
            continue;
        issues.push({
            code: 'duplicateRoleLabel',
            level: 'warning',
            message: `有 ${ids.length} 个可执行节点使用了相同名称「${key}」，职责可能重复`,
            nodeIds: ids,
            suggestion: '为职责不同的节点取不同名称；确实需要同角色多实例时，可用虚拟节点复用同一代理',
        });
    }
    return issues;
}
/**
 * b) 命名约定（warning）：meta.namingConvention 为合法正则时按正则校验 label，
 * 否则按其字面量作为前缀要求（例如「阶段」要求 label 以「阶段」开头）。
 * 只检查可执行节点（agent/parent/group 卡片）——阶段/数据节点的名称是系统锁定的。
 */
export function ruleNamingConvention({ flow, meta }) {
    const convention = String(meta?.namingConvention ?? '').trim();
    if (!convention)
        return [];
    let matches;
    if (convention.startsWith('/') && convention.length > 2) {
        // 形如 /^\d+[-. ]/ 的正则写法（首尾斜杠且中间非空；单独一个 '/' 视为前缀字面量）
        const lastSlash = convention.lastIndexOf('/');
        if (lastSlash > 1) {
            try {
                const pattern = new RegExp(convention.slice(1, lastSlash), convention.slice(lastSlash + 1));
                matches = (label) => pattern.test(label);
            }
            catch {
                // 非法正则：按前缀字面量处理（不抛错）
                matches = (label) => label.startsWith(convention);
            }
        }
        else {
            matches = (label) => label.startsWith(convention);
        }
    }
    else {
        matches = (label) => label.startsWith(convention);
    }
    const issues = [];
    for (const node of flow?.nodes ?? []) {
        if (node.kind !== 'agent' && node.kind !== 'parent' && node.kind !== 'group')
            continue;
        const label = String(node.data.label ?? '');
        if (matches(label))
            continue;
        issues.push({
            code: 'namingConvention',
            level: 'warning',
            message: `节点「${label || node.id}」的名称未满足命名约定「${convention}」`,
            nodeIds: [node.id],
            suggestion: `按命名约定重命名该节点（约定：${convention}），便于画布阅读与阶段对齐`,
        });
    }
    return issues;
}
/**
 * c) 元参数硬护栏（error，仅 origin='agent'）：节点/组/人数/并行分支/单轮 op 上限，
 * 以及下限提示（warning）。
 * 并行分支口径：**无环视图**（环上节点排除）最长路径分层后，单层内可执行单元数最大值
 * ——即「同一执行轮次里并行开工的代理数」。
 */
export function ruleMetaLimits(input, dag, cycleNodes) {
    if (input.origin !== 'agent' || !input.meta)
        return [];
    const unitIds = (input.flow?.nodes ?? [])
        .filter((node) => node.kind === 'agent' || node.kind === 'parent' || node.kind === 'group')
        .map((node) => node.id);
    const layers = computeFlowLayers(dag, cycleNodes);
    const usage = orgUsageOf(input.flow, {
        milestoneUsed: input.milestoneUsed,
        parallelBranchMax: maxLayerWidth(layers, unitIds),
        ...(input.patchOps !== undefined ? { patchOps: input.patchOps } : {}),
    });
    return metaLimitIssues(input.meta, usage);
}
//# sourceMappingURL=invariants-meta-rules.js.map