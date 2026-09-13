import type { OrgBudget } from '../shared/types.js';
/**
 * 构建「本次组织预算」末段文本（纯函数）。
 * @param budget 组织预算（orgBudgetOf 的输出：生效元参数 + 已用量 → 剩余量）
 * @returns 提示词段文本（中文；无任何可约束维度时仍输出头部与禁用拓扑两行，保持结构稳定）
 */
export declare function buildOrgBudgetText(budget: OrgBudget): string;
