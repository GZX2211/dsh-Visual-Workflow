// src/host/graph/org-meta-usage.ts
//
// 元参数「已用量」统计口径（自主编排方案 §6.4）：可执行节点数 / 协作组数 / 最大组内
// 人数 / 单列并行分支数 / 闸门已用次数 / 本批 op 数。
// 独立成文件的原因：口径是本功能最易漂移的部分（检查器、P1 写图工具、客户端预算展示
// 三处必须一致），集中一处便于单测锁定。
// 纯函数：不读时钟/随机源，不改写入参。
import { EXECUTABLE_UNIT_KINDS } from '../shared/protocol.js';
/** 可执行单元计数（agent/parent/group；与检查器、P1 工具、客户端共用同一口径）。 */
export function executableUnitCount(nodes) {
    return (nodes ?? []).filter((node) => EXECUTABLE_UNIT_KINDS.includes(node.kind)).length;
}
/** 协作组卡片计数。 */
export function groupCount(nodes) {
    return (nodes ?? []).filter((node) => node.kind === 'group').length;
}
/** 单个协作组的最大已配置人数（无组时 0；memberIds 重复 id 只计一次）。 */
export function maxGroupMembers(nodes) {
    let max = 0;
    for (const node of nodes ?? []) {
        if (node.kind !== 'group')
            continue;
        const members = Array.isArray(node.data.memberIds) ? node.data.memberIds : [];
        max = Math.max(max, new Set(members).size);
    }
    return max;
}
/** 由图文档直接推导已用量（检查器/P1 工具的统一入口）。 */
export function orgUsageOf(flow, options = {}) {
    const nodes = Array.isArray(flow?.nodes) ? flow?.nodes : [];
    const usage = {
        nodeCount: executableUnitCount(nodes),
        groupCount: groupCount(nodes),
        maxGroupMembers: maxGroupMembers(nodes),
        milestoneUsed: Math.max(0, Math.floor(Number(options.milestoneUsed) || 0)),
    };
    if (options.parallelBranchMax !== undefined)
        usage.parallelBranchMax = options.parallelBranchMax;
    if (options.patchOps !== undefined)
        usage.patchOps = options.patchOps;
    return usage;
}
//# sourceMappingURL=org-meta-usage.js.map