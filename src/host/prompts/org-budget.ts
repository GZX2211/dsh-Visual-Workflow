// src/host/prompts/org-budget.ts
//
// 「本次组织预算」提示词段构建器（自主编排方案 §6.4 注入形态）：
//   - 属**动态值** → 只在末段（TAIL_MARKER 之后）注入，前置段字节不受影响（架构文档 §13）；
//   - 给**剩余量**而非上限（父代理据此判断还能扩张多少）；
//   - 纯函数：入参不变则输出字节不变，不读时钟/随机源。
// 本轮（P0）只提供构建器与单测，实际注入点由 P2 的 SOP 组装统一接入
// （directiveParams.dynamic），避免 P0 改动运行时核心路径。

import type { OrgBudget } from '../shared/types.js'

/** 「不限」文案（上限为 0 = 未配置上限时使用）。 */
const UNLIMITED = '不限'

/** 剩余量渲染：null（不限制）→ 「不限」。 */
function remaining(value: number | null): string {
  return value === null ? UNLIMITED : String(value)
}

/**
 * 构建「本次组织预算」末段文本（纯函数）。
 * @param budget 组织预算（orgBudgetOf 的输出：生效元参数 + 已用量 → 剩余量）
 * @returns 提示词段文本（中文；无任何可约束维度时仍输出头部与禁用拓扑两行，保持结构稳定）
 */
export function buildOrgBudgetText(budget: OrgBudget): string {
  const lines: string[] = []
  lines.push('本次组织预算：')
  lines.push(`- 可执行节点 ${budget.nodeUsed}/${budget.nodeMax || UNLIMITED}（剩余 ${remaining(budget.nodeRemaining)}）`)
  if (budget.groupMax > 0) {
    lines.push(`- 协作组 ${budget.groupUsed}/${budget.groupMax}（剩余 ${remaining(budget.groupRemaining)}）；组内人数上限 ${budget.membersMax || UNLIMITED}`)
  } else {
    lines.push(`- 协作组 ${budget.groupUsed}/${UNLIMITED}；组内人数上限 ${budget.membersMax || UNLIMITED}`)
  }
  lines.push(`- 父代理闸门 ${budget.milestoneUsed}/${budget.milestoneMax || UNLIMITED}（剩余 ${remaining(budget.milestoneRemaining)}）`)
  lines.push(`- 单轮改图幅度上限 ${budget.patchOpsMax || UNLIMITED} op（剩余 ${remaining(budget.patchOpsRemaining)}）`)
  if (budget.parallelBranchMax > 0) {
    lines.push(`- 单列并行分支上限 ${budget.parallelBranchMax}`)
  }
  lines.push(
    budget.forbiddenShapes.length > 0
      ? `- 禁用拓扑：${budget.forbiddenShapes.join(' / ')}`
      : '- 禁用拓扑：无',
  )
  if (budget.namingConvention) {
    lines.push(`- 命名约定：${budget.namingConvention}`)
  }
  return lines.join('\n')
}
