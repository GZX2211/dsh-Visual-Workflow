// src/host/graph/invariants.ts
//
// 图检查器汇总层（自主编排方案 §6.1/§6.2/§6.3）：把流程子图构建、规则执行、
// forbiddenShapes 级别提升、去重/排序与「error 必带修复建议」兜底收敛为一个纯函数。
//
//   - checkGraphInvariants(input) → Issue[]：编排质量 + 元参数检查（本方案新增）；
//   - 与 validateFlow 串联关系（§6.3）：先 validateFlow（结构合法性，error 直接拒），
//     再 checkGraphInvariants；本函数**不替代** validateFlow，也不做保存端点调用
//     （保存路径保持既有行为；串联点是 P1 的 wf_graph_patch 落盘前）。
//   - origin 语义（D-05）：只有 origin='agent' 才启用元参数硬护栏；用户手改画布
//     （origin='user'）不受元参数约束。
//
// 纯函数：不读时钟/随机源，同输入同输出（输出按 level → code → message 稳定排序）。
import { buildFlowDag, detectCycleNodes } from './dag.js';
import { ruleCannotReachEnd, ruleConditionPair, ruleEndFlowIn, ruleEndRequired, ruleFlowCycle, ruleOrphanNode, ruleReachability, ruleStageDirection, ruleStartFlowOut, ruleStartRequired, } from './invariants-rules-flow.js';
import { ruleCtxSource, ruleDataNodeComplete, ruleDbTarget, ruleGroupMembers, ruleMilestoneProxy, ruleNodeDataFlowContract, ruleProxySource, ruleRoleNodeConfigured, } from './invariants-rules-nodes.js';
import { ruleDuplicateRoleLabel, ruleMetaLimits, ruleNamingConvention } from './invariants-rules-meta.js';
// code 注册表与问题类型契约的出口在 invariants-types.ts；本文件只负责规则聚合。
/** error 级 issue 缺少修复建议时的兜底文案（模型自我修正通道必须非空）。 */
const FALLBACK_SUGGESTION = '按提示修正画布拓扑后重新提交；若为设计意图，请先调整元参数（set_meta）再改图。';
/** 级别序：error 在前（模型与调用方优先看阻断项）。 */
function levelRank(level) {
    return level === 'error' ? 0 : 1;
}
/** 去重键：级别 + code + 定位集合（同一问题被多条规则重复命中时只保留一条）。 */
function issueKey(issue) {
    const nodes = [...(issue.nodeIds ?? [])].sort().join(',');
    const lines = [...(issue.lineIds ?? [])].sort().join(',');
    return `${issue.level}|${issue.code}|${nodes}|${lines}|${issue.message}`;
}
/**
 * 检查编排图（纯函数）。
 *
 * @param input.flow   待检查的图（节点/连线/模式）
 * @param input.meta   生效元参数；缺省则不约束
 * @param input.origin 变更来源；仅 'agent' 启用元参数硬护栏（D-05）
 * @param input.patchOps 本批改图操作数（P1 wf_graph_patch 传入；与 patchOpsMax 比对）
 * @param input.milestoneUsed 父代理闸门已用次数（不含首次编排，D-21）
 */
export function checkGraphInvariants(input) {
    const dag = buildFlowDag(input.flow?.nodes, input.flow?.lines);
    const cycleNodes = detectCycleNodes(dag);
    const issues = [
        // 流程与阶段维度
        ...ruleStartRequired(input),
        ...ruleStartFlowOut(input, dag),
        ...ruleEndRequired(input),
        ...ruleEndFlowIn(input, dag),
        ...ruleOrphanNode(input),
        ...ruleConditionPair(input),
        ...ruleFlowCycle(input, dag, cycleNodes),
        ...ruleReachability(input, dag),
        ...ruleCannotReachEnd(input, dag),
        ...ruleStageDirection(input, dag),
        // 节点维度
        ...ruleGroupMembers(input, dag),
        ...ruleProxySource(input),
        ...ruleDataNodeComplete(input),
        ...ruleCtxSource(input),
        ...ruleDbTarget(input),
        // 数据流契约与角色配置（规划期可见性提醒；warning 级不阻断）
        ...ruleNodeDataFlowContract(input),
        ...ruleRoleNodeConfigured(input),
        ...ruleMilestoneProxy(input, dag),
        // 元参数与命名维度
        ...ruleDuplicateRoleLabel(input),
        ...ruleNamingConvention(input),
        ...ruleMetaLimits(input, dag, cycleNodes),
    ];
    const forbidden = new Set((input.meta?.forbiddenShapes ?? []).map((code) => String(code)));
    const seen = new Set();
    const normalized = [];
    for (const raw of issues) {
        // forbiddenShapes 级别提升（拓扑禁令开关）：命中的 code 从 warning 提升为 error（§6.2）
        const escalated = raw.level === 'warning' && forbidden.has(raw.code);
        const issue = {
            code: raw.code,
            level: escalated ? 'error' : raw.level,
            message: raw.message,
            ...(raw.nodeIds && raw.nodeIds.length > 0 ? { nodeIds: [...raw.nodeIds] } : {}),
            ...(raw.lineIds && raw.lineIds.length > 0 ? { lineIds: [...raw.lineIds] } : {}),
            suggestion: escalated
                ? `${raw.suggestion ?? ''}（该拓扑已被元参数 forbiddenShapes 列为禁用）`.trim()
                : raw.suggestion,
        };
        // error 必带修复建议：规则未给建议时兜底，绝不留下「只报错不给出路」的条目
        if (issue.level === 'error' && !String(issue.suggestion ?? '').trim()) {
            issue.suggestion = FALLBACK_SUGGESTION;
        }
        if (!issue.suggestion)
            delete issue.suggestion;
        const key = issueKey(issue);
        if (seen.has(key))
            continue;
        seen.add(key);
        normalized.push(issue);
    }
    return normalized.sort((a, b) => {
        const byLevel = levelRank(a.level) - levelRank(b.level);
        if (byLevel !== 0)
            return byLevel;
        if (a.code !== b.code)
            return a.code < b.code ? -1 : 1;
        return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
    });
}
/** 是否含阻断级问题（调用方落盘前判定用）。 */
export function hasBlockingIssues(issues) {
    return (issues ?? []).some((issue) => issue.level === 'error');
}
//# sourceMappingURL=invariants.js.map