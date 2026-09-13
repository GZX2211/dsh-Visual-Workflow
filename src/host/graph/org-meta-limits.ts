// src/host/graph/org-meta-limits.ts
//
// 元参数**硬护栏**判定（自主编排方案 §6.4 / 决策 D-04、D-05）：
//   - 只判「上限类」字段（成本与规模风险方向）→ error 级，违反即拒绝落盘；
//   - 下限类字段（nodeMin/membersMin）只产出 warning 提示（设计意图，不阻断增量改图）；
//   - 只对 origin='agent' 的改图生效（D-05：元参数不约束用户手改画布），由调用方决定
//     是否调用本函数——本层不做 origin 判定，保持纯函数。
// issue 的 code 与检查器共用（metaLimitExceeded / metaBelowMin），message 中文可读、
// error 必带修复建议（模型自我修正的唯一通道）。

import type { OrgMeta } from '../shared/types.js'
import type { OrgUsage } from './org-meta-usage.js'
import type { GraphIssue } from './invariants-types.js'

/** 元参数超限 issue 的稳定 code（error 级）。 */
export const META_LIMIT_CODE = 'metaLimitExceeded'

/** 元参数低于下限 issue 的稳定 code（warning 级）。 */
export const META_BELOW_MIN_CODE = 'metaBelowMin'

/**
 * 元参数硬护栏判定：返回稳定 code 的 issue 列表；空数组 = 通过。
 * 纯函数：入参不变则输出不变（不读时钟/随机源）。
 */
export function metaLimitIssues(meta: OrgMeta, usage: OrgUsage): GraphIssue[] {
  const issues: GraphIssue[] = []
  const nodeMax = Number(meta.nodeMax) || 0
  if (nodeMax > 0 && usage.nodeCount > nodeMax) {
    issues.push({
      code: META_LIMIT_CODE,
      level: 'error',
      message: `可执行节点数 ${usage.nodeCount} 超过元参数上限 ${nodeMax}`,
      suggestion: `删减或合并可执行节点（agent/parent/group）至 ${nodeMax} 个以内；如需更大规模，请先以 set_meta 提高 nodeMax`,
    })
  }
  const groupMax = Number(meta.groupMax) || 0
  if (groupMax > 0 && usage.groupCount > groupMax) {
    issues.push({
      code: META_LIMIT_CODE,
      level: 'error',
      message: `协作组数 ${usage.groupCount} 超过元参数上限 ${groupMax}`,
      suggestion: `减少协作组卡片数量至 ${groupMax} 个以内，或把成员改为独立节点串行执行`,
    })
  }
  const membersMax = Number(meta.membersMax) || 0
  if (membersMax > 0 && usage.maxGroupMembers > membersMax) {
    issues.push({
      code: META_LIMIT_CODE,
      level: 'error',
      message: `存在组内人数 ${usage.maxGroupMembers} 超过元参数上限 ${membersMax}`,
      suggestion: `把超限协作组拆成多个组（每组 ≤ ${membersMax} 人），或减少组成员数`,
    })
  }
  const parallelBranchMax = Number(meta.parallelBranchMax) || 0
  if (parallelBranchMax > 0 && usage.parallelBranchMax !== undefined && usage.parallelBranchMax > parallelBranchMax) {
    issues.push({
      code: META_LIMIT_CODE,
      level: 'error',
      message: `单列并行分支 ${usage.parallelBranchMax} 超过元参数上限 ${parallelBranchMax}`,
      suggestion: `把并行分支改为串行或分批，单列并行数不超过 ${parallelBranchMax}`,
    })
  }
  const patchOpsMax = Number(meta.patchOpsMax) || 0
  if (patchOpsMax > 0 && usage.patchOps !== undefined && usage.patchOps > patchOpsMax) {
    issues.push({
      code: META_LIMIT_CODE,
      level: 'error',
      message: `单轮改图 ${usage.patchOps} 个操作超过元参数上限 ${patchOpsMax}`,
      suggestion: `拆成多轮补丁提交，每轮不超过 ${patchOpsMax} 个操作`,
    })
  }
  // 下限提示（warning，不阻断落盘）
  const nodeMin = Number(meta.nodeMin) || 0
  if (nodeMin > 0 && usage.nodeCount < nodeMin) {
    issues.push({
      code: META_BELOW_MIN_CODE,
      level: 'warning',
      message: `可执行节点数 ${usage.nodeCount} 低于元参数下限 ${nodeMin}`,
    })
  }
  const membersMin = Number(meta.membersMin) || 0
  if (membersMin > 0 && usage.groupCount > 0 && usage.maxGroupMembers < membersMin) {
    issues.push({
      code: META_BELOW_MIN_CODE,
      level: 'warning',
      message: `组内人数 ${usage.maxGroupMembers} 低于元参数下限 ${membersMin}`,
    })
  }
  return issues
}
