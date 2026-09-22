import type { CheckGraphInput, GraphIssue } from './invariants-types.js';
/**
 * 检查编排图（纯函数）。
 *
 * @param input.flow   待检查的图（节点/连线/模式）
 * @param input.meta   生效元参数；缺省则不约束
 * @param input.origin 变更来源；仅 'agent' 启用元参数硬护栏（D-05）
 * @param input.patchOps 本批改图操作数（P1 wf_graph_patch 传入；与 patchOpsMax 比对）
 * @param input.milestoneUsed 父代理闸门已用次数（不含首次编排，D-21）
 */
export declare function checkGraphInvariants(input: CheckGraphInput): GraphIssue[];
/** 是否含阻断级问题（调用方落盘前判定用）。 */
export declare function hasBlockingIssues(issues: GraphIssue[] | null | undefined): boolean;
