// src/host/graph/index.ts
//
// 图模块**唯一公共入口**（barrel）：
//   - 模块外（orchestrator / tools / service / agent / storage 及全部测试）一律从本入口
//     导入，不得直接引用模块内部文件（见同目录 AGENTS.md「公共边界」）；
//   - 内部文件之间仍使用相对路径导入；本文件不含任何实现。
//
// 刻意**不**在本入口公开的内部实现（它们不是对外契约）：
//   - 检查器的单条规则函数（invariants-rules-*.ts）与内部遍历助手：只服务
//     checkGraphInvariants 的聚合，调用方通过聚合入口获取问题列表；
//   - 注册表格式自检等实现细节。
// 若确实需要公开其中某项，先判断它是否表达真实、稳定、可维护的对外契约，
// 再在本文件显式登记——不要为「方便」整体 re-export 内部文件。
// ── 图契约：连接点矩阵、通道配对与节点种类 ─────────────────────────────────
export { CONDITION_TYPES, HANDLE_PAIRING, NODE_HANDLES, NODE_KINDS } from './model.js';
// ── 图契约：节点/连线工厂与阶段节点硬编码名称 ───────────────────────────────
export { makeLineId, makeNodeId, newDatabaseNode, newFileNode, newGroupNode, newLine, newProxyNode, newRoleNode, newStageNode, stageLabel, } from './model.js';
// ── 拓扑查询（只读，不改变图）─────────────────────────────────────────────
export { ctxInEdges, dbInEdges, downstreamFlowNodeIds, entryNodes, flowInEdges, flowOutEdges, lineById, nodeById, proxiesOf, upstreamCtxNodeIds, } from './model.js';
// ── 图结构判定 ───────────────────────────────────────────────────────────
export { isFlowLine } from './dag.js';
export { nodeHasFlowIn, nodeParticipatesInFlow } from './model.js';
// ── 虚拟节点（闸门）与协作组语义 ──────────────────────────────────────────
export { activeMilestoneGateOf, groupMemberIds, isGroupMember, mainNodeIdOf, memberGroupId, milestoneProxiesOf, proxyRoleOf, } from './model.js';
// ── 流程子图算法（图论纯函数）─────────────────────────────────────────────
export { buildFlowDag, computeFlowLayers, detectCycleNodes, maxLayerWidth } from './dag.js';
// ── 结构校验与归一化 ─────────────────────────────────────────────────────
export { connectionProblem, missingStageNodes, normalizeFlow, validateFlow } from './validate.js';
// ── 编排质量检查器（问题聚合入口 + code 注册表）────────────────────────────
export { checkGraphInvariants, hasBlockingIssues } from './invariants.js';
export { GRAPH_INVARIANT_CODES, META_BELOW_MIN_CODE, META_LIMIT_EXCEEDED_CODE, invariantCodeInfo, } from './invariants-types.js';
// ── 组织元参数：装配与预算 ────────────────────────────────────────────────
export { ORG_META_LIMIT_DEFAULTS, ORG_META_NORMALIZE_CAPS, effectiveOrgMeta, freezeOrgMeta, metaOfDocument, normalizeOrgMeta, orgBudgetOf, } from './org-meta.js';
// ── 组织元参数：已用量口径与硬护栏判定 ────────────────────────────────────
export { metaLimitIssues } from './org-meta-limits.js';
export { executableUnitCount, groupCount, maxGroupMembers, orgUsageOf } from './org-meta-usage.js';
//# sourceMappingURL=index.js.map