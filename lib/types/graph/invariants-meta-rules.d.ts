import { type FlowDag } from './dag.js';
import type { CheckGraphInput, GraphIssue } from './invariants-types.js';
/** a) 角色名重复（warning；服务「最少子代理数」目标）。 */
export declare function ruleDuplicateRoleLabel({ flow }: CheckGraphInput): GraphIssue[];
/**
 * b) 命名约定（warning）：meta.namingConvention 为合法正则时按正则校验 label，
 * 否则按其字面量作为前缀要求（例如「阶段」要求 label 以「阶段」开头）。
 * 只检查可执行节点（agent/parent/group 卡片）——阶段/数据节点的名称是系统锁定的。
 */
export declare function ruleNamingConvention({ flow, meta }: CheckGraphInput): GraphIssue[];
/**
 * c) 元参数硬护栏（error，仅 origin='agent'）：节点/组/人数/并行分支/单轮 op 上限，
 * 以及下限提示（warning）。
 * 并行分支口径：**无环视图**（环上节点排除）最长路径分层后，单层内可执行单元数最大值
 * ——即「同一执行轮次里并行开工的代理数」。
 */
export declare function ruleMetaLimits(input: CheckGraphInput, dag: FlowDag, cycleNodes: Set<string>): GraphIssue[];
