// src/host/graph/validate.ts
//
// 工作流结构校验（T-013）：单连线问题检测（connectionProblem）与全量校验（validateFlow）。
// 运行前完整性检查（缺失启动/结束节点）归编排运行入口，见文件尾部说明。
//
// 校验规则清单（架构文档 §4.2 校验规则段 + 需求文档 §4.2/§4.3/§4.2.5）：
//   1. 节点合法性：id 非空、kind 属于 NODE_KINDS、id 不重复；
//   2. 连线端点存在、无自环、无重复连线；
//   3. 连接点兼容矩阵：sourceHandle 必须是源节点出点、targetHandle 必须是目标节点入点，
//      且三通道配对（flow-out→flow-in / ctx-out→ctx-in / db-out→db-in）；
//   4. 条件仅流程线（§4.3 规则 4）；content 条件必须带 label（§4.3 规则 2）；
//   5. Team 边界（§4.2.5.2 规则 4）：组成员仅 ctx/db 连接点；Team 卡片仅 flow 连接点；
//   6. 阶段节点唯一：start/end 各至多一个（§4.2.5.1 说明段）；pause 仅模式一；
//   7. 父代理唯一：至多一个；模式二必须恰好一个（§4.2.3.1 / §4.1.3 规则 4）；
//   8. 虚拟节点引用存在且主节点为角色节点；主/虚不得同时连入同一目标同一连接点（§4.2.3.2 规则 6）；
//   9. 模式差异：mode1 的 start 禁用 ctx-out、end 禁用 ctx-in（上下文出/入仅模式二的输入/输出节点）。
//
// 为什么校验不做「保存前归一化」（2026.10 治理决策）：
// 本模块曾同时提供 validateFlow（只读校验）与 normalizeFlow（保存前补默认值的深拷贝）。
// 后者在生产代码中**从未被调用**，实际落盘形状由各写入路径自己保证：
//   - 画布新建：graph/model.ts 的工厂函数（newRoleNode 等）产出完整 data；
//   - 父代理改图：tools/wf-graph-patch/apply.ts 的 normalizeRoleNodeData（图结构补丁的
//     唯一规范化入口，补缺字段且保留未知字段）；
//   - 导入/模板实例化：模板与实例同源，形状一致。
// 而 normalizeFlow 实现为「顶层字段白名单 + 节点 data 白名单重写」：一旦接入保存端点，
// 会丢掉文档层 meta（自主编排元参数）与 lastPatch（AI 调整角标），并静默丢弃未来新增的
// 节点字段——即它的收益已被别处覆盖、代价却是数据丢失。故删除，避免留下一份「看起来
// 在生效、实际未接入，接入即致损」的伪契约。

import { NODE_HANDLES, channelIn, channelOut, pairingTargetOf, CONDITION_TYPES, NODE_KINDS, stageLabel } from './model.js'
import type { GraphNode, Line, WorkflowDocument, WorkflowMode } from '../shared/graph-model.js'

// ---------------------------------------------------------------------------
// 问题类型
// ---------------------------------------------------------------------------

/** 校验问题记录：code 为稳定错误码（UI 国际化与测试断言共用）。 */
export interface FlowIssue {
  code: string
  message: string
  /** 关联节点/连线 id（可选）。 */
  id?: string
}

/** 校验结果：ok 为 true 表示无问题（业务完整性如"启动+结束存在"不在此判定，§4.2.5.1 规则 6 由运行入口检查）。 */
export interface ValidateResult {
  ok: boolean
  issues: FlowIssue[]
}

// ---------------------------------------------------------------------------
// 单连线问题检测
// ---------------------------------------------------------------------------

/** 单连线检测结果。 */
export interface ConnectionCheck {
  valid: boolean
  code: string
  message: string
}

/**
 * 检测单条连线的连接点合法性（矩阵 + 通道配对 + 端点存在 + 自环）。
 * 纯函数：不改写任何输入。
 */
export function connectionProblem(nodes: GraphNode[], line: Line): ConnectionCheck {
  if (!line || !line.source || !line.target) {
    return { valid: false, code: 'invalidConnection', message: 'edge is missing an endpoint' }
  }
  if (line.source === line.target) {
    return { valid: false, code: 'selfLoop', message: 'self-loops are not allowed' }
  }
  const source = nodes.find((n) => n.id === line.source)
  const target = nodes.find((n) => n.id === line.target)
  if (!source || !target) {
    return { valid: false, code: 'invalidNode', message: 'the edge endpoint node does not exist' }
  }
  const sourceDef = NODE_HANDLES[source.kind]
  const targetDef = NODE_HANDLES[target.kind]
  if (!sourceDef.outputs.includes(line.sourceHandle)) {
    return { valid: false, code: 'invalidHandle', message: `node ${source.kind} (${line.source}) has no output port ${line.sourceHandle}` }
  }
  if (!targetDef.inputs.includes(line.targetHandle)) {
    return { valid: false, code: 'invalidHandle', message: `node ${target.kind} (${line.target}) has no input port ${line.targetHandle}` }
  }
  // 三通道配对：db-out 只能连 db-in（数据库内容绝不注入上下文，§4.2.4.2 规则 4）
  const expectedTarget = pairingTargetOf(line.sourceHandle)
  if (line.targetHandle !== expectedTarget) {
    return { valid: false, code: 'handleMismatch', message: `${line.sourceHandle} can only connect ${expectedTarget}` }
  }
  // 条件仅流程线（§4.3 规则 4）
  if (line.condition && line.sourceHandle !== channelOut('flow')) {
    return { valid: false, code: 'conditionOnNonFlow', message: 'conditional edges are supported on flow-out -> flow-in only' }
  }
  return { valid: true, code: 'ok', message: '' }
}

// ---------------------------------------------------------------------------
// 全量校验
// ---------------------------------------------------------------------------

/**
 * 全量校验工作流：结构/拓扑/约束合法性。
 * 注意：不含「启动+结束存在」的运行前检查（§4.2.5.1 规则 6 属于运行入口的 Toast 提示，
 * 保存中间态画布应当被允许——与旧项目语义一致）。
 */
export function validateFlow(flow: Partial<WorkflowDocument>): ValidateResult {
  const issues: FlowIssue[] = []
  const nodes: GraphNode[] = Array.isArray(flow.nodes) ? (flow.nodes as GraphNode[]) : []
  const lines: Line[] = Array.isArray(flow.lines) ? (flow.lines as Line[]) : []
  const mode: WorkflowMode = flow.mode === 'mode2' ? 'mode2' : 'mode1'

  // —— 节点合法性 ——
  const seen = new Set<string>()
  const nodeMap = new Map<string, GraphNode>()
  for (const node of nodes) {
    if (!node || !node.id) {
      issues.push({ code: 'badNode', message: `invalid node: ${JSON.stringify(node)}` })
      continue
    }
    if (!NODE_KINDS.includes(node.kind)) {
      issues.push({ code: 'badNode', message: `node ${node.id} has an invalid kind: ${String((node as GraphNode).kind)}` })
      continue
    }
    if (seen.has(node.id)) issues.push({ code: 'dupNode', message: `duplicate node id: ${node.id}`, id: node.id })
    seen.add(node.id)
    nodeMap.set(node.id, node)

    // 阶段节点属性锁定：label 必须为硬编码名称（§4.2.5.1）
    if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
      const expected = stageLabel(node.kind, mode)
      if (node.data.label !== expected) {
        issues.push({ code: 'stageLabelLocked', message: `stage node ${node.id} has its label locked to "${expected}"`, id: node.id })
      }
    }
    // 虚拟节点：必须携带引用且引用主节点存在且为角色节点（§4.2.3.2 规则 4/7）
    if (node.kind === 'proxy') {
      if (!node.proxySourceId) {
        issues.push({ code: 'proxySourceMissing', message: `proxy node ${node.id} is missing its source node reference`, id: node.id })
      }
    }
    // 角色节点：retryLimit 必为有限正数（归一化会补默认，此处只防显式非法值）
    if ((node.kind === 'parent' || node.kind === 'agent') && typeof node.data.retryLimit === 'number') {
      if (!Number.isFinite(node.data.retryLimit) || node.data.retryLimit < 0) {
        issues.push({ code: 'badRetryLimit', message: `node ${node.id} has an invalid retryLimit`, id: node.id })
      }
    }
  }

  // —— 虚拟节点引用与主虚互斥（§4.2.3.2 规则 6/7）——
  for (const node of nodes) {
    if (node.kind !== 'proxy' || !node.proxySourceId) continue
    const source = nodeMap.get(node.proxySourceId)
    if (!source) {
      issues.push({ code: 'proxySourceMissing', message: `proxy node ${node.id} references a source node ${node.proxySourceId} that does not exist`, id: node.id })
      continue
    }
    if (source.kind !== 'parent' && source.kind !== 'agent') {
      issues.push({ code: 'proxySourceKind', message: `proxy node ${node.id} can only reference a role node (currently ${source.kind})`, id: node.id })
    }
  }
  // 主/虚不得同时连入同一目标节点的同一连接点（防止重复触发，§4.2.3.2 规则 6）
  const inByTarget = new Map<string, Line[]>()
  for (const l of lines) {
    const key = `${l.target}|${l.targetHandle}`
    const arr = inByTarget.get(key) ?? []
    arr.push(l)
    inByTarget.set(key, arr)
  }
  for (const [key, arr] of inByTarget) {
    const [targetId] = key.split('|')
    const seenSources = new Set<string>()
    for (const l of arr) {
      const sourceId = l.source
      const source = nodeMap.get(sourceId)
      if (!source) continue
      // 主节点与其任一虚拟节点视为同一执行代理：同 target+handle 上二者并存即互斥。
      // 分支判定 source 为主节点即可（id 全画布唯一，主节点 id 不可能出现在 proxy
      // 节点集合中，无需再做 proxyIds 排除——原恒真条件已删，Bug 21 冗余清理）。
      const effectiveIds = new Set<string>([sourceId])
      if (source.kind === 'proxy' && source.proxySourceId) effectiveIds.add(source.proxySourceId)
      if (source.kind === 'parent' || source.kind === 'agent') {
        // 主节点：收集其虚拟节点 id
        for (const p of nodes) {
          if (p.kind === 'proxy' && p.proxySourceId === sourceId) effectiveIds.add(p.id)
        }
      }
      for (const eff of effectiveIds) {
        if (seenSources.has(eff)) {
          issues.push({ code: 'proxyParallel', message: `a source node and its proxy node must not both connect to the same port of ${targetId}`, id: l.id })
          break
        }
        seenSources.add(eff)
      }
    }
  }

  // —— 连线合法性 ——
  const lineKeys = new Set<string>()
  for (const line of lines) {
    const problem = connectionProblem(nodes, line)
    if (!problem.valid) {
      issues.push({ code: problem.code, message: `${problem.message}（${line.source} → ${line.target}）`, id: line.id })
      continue
    }
    const key = `${line.source}|${line.target}|${line.sourceHandle}|${line.targetHandle}`
    if (lineKeys.has(key)) {
      issues.push({ code: 'dupEdge', message: `duplicate edge: ${line.source} -> ${line.target}`, id: line.id })
    }
    lineKeys.add(key)

    // 条件连线：content 必须带内容值（§4.3 规则 2/属性设计表）
    if (line.condition) {
      if (!CONDITION_TYPES.includes(line.condition.type)) {
        issues.push({ code: 'badCondition', message: `invalid condition type: ${String((line.condition as { type: string }).type)}`, id: line.id })
      }
      if (line.condition.type === 'content' && !(line.condition.label ?? '').trim()) {
        issues.push({ code: 'contentLabelRequired', message: 'a content condition must carry its content value', id: line.id })
      }
    }

    // Team 边界（§4.2.5.2 规则 4）：组内成员仅 ctx/db 连接点；Team 卡片仅 flow
    const source = nodeMap.get(line.source)
    const target = nodeMap.get(line.target)
    const sourceInGroup = source && (source.kind === 'parent' || source.kind === 'agent') && Boolean(source.data.groupId)
    const targetInGroup = target && (target.kind === 'parent' || target.kind === 'agent') && Boolean(target.data.groupId)
    if (sourceInGroup && (line.sourceHandle === channelOut('flow'))) {
      issues.push({ code: 'groupMemberFlowHandle', message: `Team member ${line.source} only has context ports, no flow-out`, id: line.id })
    }
    if (targetInGroup && line.targetHandle === channelIn('flow')) {
      issues.push({ code: 'groupMemberFlowHandle', message: `Team member ${line.target} only has context ports, no flow-in`, id: line.id })
    }
    // Team 卡片仅 flow 连接点：矩阵（NODE_HANDLES.group 只有 flow-in/flow-out）已在
    // connectionProblem 层拦截 Team 卡片的 ctx/db 连线（invalidHandle/handleMismatch），
    // 此处无需重复检查（避免死代码）。

    // 模式差异（§4.2.5.1）：mode1 的 start 无 ctx-out；mode1 的 end 无 ctx-in
    if (mode === 'mode1') {
      if (source && source.kind === 'start' && line.sourceHandle === channelOut('ctx')) {
        issues.push({ code: 'mode1StartCtxOut', message: 'a mode1 start node has no context-out (only the mode2 input node provides one)', id: line.id })
      }
      if (target && target.kind === 'end' && line.targetHandle === channelIn('ctx')) {
        issues.push({ code: 'mode1EndCtxIn', message: 'a mode1 end node has no context-in (only the mode2 output node provides one)', id: line.id })
      }
    }
  }

  // —— 阶段节点唯一性（§4.2.5.1 说明段：启动/输入与结束/输出各至多一个）——
  const starts = nodes.filter((n) => n.kind === 'start')
  const ends = nodes.filter((n) => n.kind === 'end')
  if (starts.length > 1) issues.push({ code: 'startUnique', message: `there must be exactly one start/input node (currently ${starts.length})` })
  if (ends.length > 1) issues.push({ code: 'endUnique', message: `there must be exactly one end/output node (currently ${ends.length})` })
  // 暂停节点仅模式一（§4.2.5.1 规则 2：模式二左侧栏不显示暂停）
  if (mode === 'mode2' && nodes.some((n) => n.kind === 'pause')) {
    issues.push({ code: 'pauseMode2', message: 'a mode2 workflow does not allow pause nodes' })
  }

  // —— 父代理唯一性（§4.2.3.1 规则 5：至多一个；模式二必须恰好一个）——
  const parents = nodes.filter((n) => n.kind === 'parent')
  if (parents.length > 1) issues.push({ code: 'parentUnique', message: `at most one parent-agent node is allowed (currently ${parents.length})` })
  if (mode === 'mode2' && parents.length === 0) {
    issues.push({ code: 'parentRequiredMode2', message: 'a mode2 workflow must contain a parent-agent node' })
  }

  // —— Team 成员一致性：成员 id 必须真实存在（§4.2.5.2）——
  // 幽灵组员防护：角色节点声明 groupId 指向不存在的组 id 时必须报错。
  const groupIds = new Set(nodes.filter((n) => n.kind === 'group').map((n) => n.id))
  for (const node of nodes) {
    if ((node.kind === 'parent' || node.kind === 'agent') && node.data.groupId && !groupIds.has(node.data.groupId)) {
      issues.push({ code: 'groupGhost', message: `node ${node.id} declares membership in Team ${node.data.groupId}, but that group does not exist`, id: node.id })
    }
  }
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    for (const mid of node.data.memberIds ?? []) {
      const m = nodeMap.get(mid)
      if (!m) {
        issues.push({ code: 'groupMemberMissing', message: `Team ${node.id} references a member ${mid} that does not exist`, id: node.id })
        continue
      }
      if (m.kind !== 'parent' && m.kind !== 'agent') {
        issues.push({ code: 'groupMemberKind', message: `Team ${node.id} member ${mid} must be a role node`, id: node.id })
      }
    }
    // 成员节点的 groupId 与组 memberIds 双向一致
    for (const m of nodes) {
      if ((m.kind === 'parent' || m.kind === 'agent') && m.data.groupId === node.id && !(node.data.memberIds ?? []).includes(m.id)) {
        issues.push({ code: 'groupMemberMismatch', message: `node ${m.id} declares membership in Team ${node.id}, but the group does not list it as a member`, id: m.id })
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

// 运行前完整性检查（缺失的启动/输入与结束/输出节点）**不在本模块**：
// 它属于编排运行入口的职责，唯一实现在 orchestrator/graph-facts.ts 的
// `missingStageLabels`（按模式渲染中文标签并组装 WfError）。
// 本模块曾另有等价的 missingStageNodes（返回 'start'/'end' 英文键），生产代码零调用，
// 2026.10 治理中删除——同一判定只保留一处实现，避免口径各自漂移。
