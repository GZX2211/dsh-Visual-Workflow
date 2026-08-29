// src/host/graph/validate.ts
//
// 工作流校验与归一化（T-013）：单连线问题检测（connectionProblem）、
// 全量校验（validateFlow）与默认值补全（normalizeFlow）。
//
// 校验规则清单（架构文档 §4.2 校验规则段 + 需求文档 §4.2/§4.3/§4.2.5）：
//   1. 节点合法性：id 非空、kind 属于 NODE_KINDS、id 不重复；
//   2. 连线端点存在、无自环、无重复连线；
//   3. 连接点兼容矩阵：sourceHandle 必须是源节点出点、targetHandle 必须是目标节点入点，
//      且三通道配对（flow-out→flow-in / ctx-out→ctx-in / db-out→db-in）；
//   4. 条件仅流程线（§4.3 规则 4）；content 条件必须带 label（§4.3 规则 2）；
//   5. 协作组边界（§4.2.5.2 规则 4）：组成员仅 ctx/db 连接点；组卡片仅 flow 连接点；
//   6. 阶段节点唯一：start/end 各至多一个（§4.2.5.1 说明段）；pause 仅模式一；
//   7. 父代理唯一：至多一个；模式二必须恰好一个（§4.2.3.1 / §4.1.3 规则 4）；
//   8. 虚拟节点引用存在且主节点为角色节点；主/虚不得同时连入同一目标同一连接点（§4.2.3.2 规则 6）；
//   9. 模式差异：mode1 的 start 禁用 ctx-out、end 禁用 ctx-in（上下文出/入仅模式二的输入/输出节点）。
//
// 为什么校验与归一化分开（§4.2.1 节点 JSON 即事实源）：校验只读不改写，归一化
// 产出可保存的规范快照；保存前调用 normalizeFlow → validateFlow，运行前再查业务
// 完整性（启动+结束存在等由 T-021 编排器报 Toast 级错误）。

import { NODE_HANDLES, HANDLE_PAIRING, CONDITION_TYPES, NODE_KINDS, stageLabel } from './model.js'
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
    return { valid: false, code: 'invalidConnection', message: '连线缺少端点' }
  }
  if (line.source === line.target) {
    return { valid: false, code: 'selfLoop', message: '不允许自环' }
  }
  const source = nodes.find((n) => n.id === line.source)
  const target = nodes.find((n) => n.id === line.target)
  if (!source || !target) {
    return { valid: false, code: 'invalidNode', message: '连线端点节点不存在' }
  }
  const sourceDef = NODE_HANDLES[source.kind]
  const targetDef = NODE_HANDLES[target.kind]
  if (!sourceDef.outputs.includes(line.sourceHandle)) {
    return { valid: false, code: 'invalidHandle', message: `节点 ${source.kind}（${line.source}）没有输出点 ${line.sourceHandle}` }
  }
  if (!targetDef.inputs.includes(line.targetHandle)) {
    return { valid: false, code: 'invalidHandle', message: `节点 ${target.kind}（${line.target}）没有输入点 ${line.targetHandle}` }
  }
  // 三通道配对：db-out 只能连 db-in（数据库内容绝不注入上下文，§4.2.4.2 规则 4）
  const expectedTarget = HANDLE_PAIRING[line.sourceHandle]
  if (line.targetHandle !== expectedTarget) {
    return { valid: false, code: 'handleMismatch', message: `${line.sourceHandle} 只能连接 ${expectedTarget}` }
  }
  // 条件仅流程线（§4.3 规则 4）
  if (line.condition && line.sourceHandle !== 'flow-out') {
    return { valid: false, code: 'conditionOnNonFlow', message: '条件连线仅支持流程出 → 流程入' }
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
      issues.push({ code: 'badNode', message: `非法节点：${JSON.stringify(node)}` })
      continue
    }
    if (!NODE_KINDS.includes(node.kind)) {
      issues.push({ code: 'badNode', message: `节点 ${node.id} 的 kind 非法：${String((node as GraphNode).kind)}` })
      continue
    }
    if (seen.has(node.id)) issues.push({ code: 'dupNode', message: `节点 id 重复：${node.id}`, id: node.id })
    seen.add(node.id)
    nodeMap.set(node.id, node)

    // 阶段节点属性锁定：label 必须为硬编码名称（§4.2.5.1）
    if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
      const expected = stageLabel(node.kind, mode)
      if (node.data.label !== expected) {
        issues.push({ code: 'stageLabelLocked', message: `阶段节点 ${node.id} 名称锁定为「${expected}」`, id: node.id })
      }
    }
    // 虚拟节点：必须携带引用且引用主节点存在且为角色节点（§4.2.3.2 规则 4/7）
    if (node.kind === 'proxy') {
      if (!node.proxySourceId) {
        issues.push({ code: 'proxySourceMissing', message: `虚拟节点 ${node.id} 缺少引用主节点`, id: node.id })
      }
    }
    // 角色节点：retryLimit 必为有限正数（归一化会补默认，此处只防显式非法值）
    if ((node.kind === 'parent' || node.kind === 'agent') && typeof node.data.retryLimit === 'number') {
      if (!Number.isFinite(node.data.retryLimit) || node.data.retryLimit < 0) {
        issues.push({ code: 'badRetryLimit', message: `节点 ${node.id} 的 retryLimit 非法`, id: node.id })
      }
    }
  }

  // —— 虚拟节点引用与主虚互斥（§4.2.3.2 规则 6/7）——
  for (const node of nodes) {
    if (node.kind !== 'proxy' || !node.proxySourceId) continue
    const source = nodeMap.get(node.proxySourceId)
    if (!source) {
      issues.push({ code: 'proxySourceMissing', message: `虚拟节点 ${node.id} 引用的主节点 ${node.proxySourceId} 不存在`, id: node.id })
      continue
    }
    if (source.kind !== 'parent' && source.kind !== 'agent') {
      issues.push({ code: 'proxySourceKind', message: `虚拟节点 ${node.id} 只能引用角色节点（当前为 ${source.kind}）`, id: node.id })
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
          issues.push({ code: 'proxyParallel', message: `主节点与其虚拟节点不得同时连入 ${targetId} 的同一连接点`, id: l.id })
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
      issues.push({ code: 'dupEdge', message: `重复连线：${line.source} → ${line.target}`, id: line.id })
    }
    lineKeys.add(key)

    // 条件连线：content 必须带内容值（§4.3 规则 2/属性设计表）
    if (line.condition) {
      if (!CONDITION_TYPES.includes(line.condition.type)) {
        issues.push({ code: 'badCondition', message: `非法条件类型：${String((line.condition as { type: string }).type)}`, id: line.id })
      }
      if (line.condition.type === 'content' && !(line.condition.label ?? '').trim()) {
        issues.push({ code: 'contentLabelRequired', message: '条件类型「内容」必须填写内容值', id: line.id })
      }
    }

    // 协作组边界（§4.2.5.2 规则 4）：组内成员仅 ctx/db 连接点；组卡片仅 flow
    const source = nodeMap.get(line.source)
    const target = nodeMap.get(line.target)
    const sourceInGroup = source && (source.kind === 'parent' || source.kind === 'agent') && Boolean(source.data.groupId)
    const targetInGroup = target && (target.kind === 'parent' || target.kind === 'agent') && Boolean(target.data.groupId)
    if (sourceInGroup && (line.sourceHandle === 'flow-out')) {
      issues.push({ code: 'groupMemberFlowHandle', message: `协作组成员 ${line.source} 仅有上下文连接点，无流程出`, id: line.id })
    }
    if (targetInGroup && line.targetHandle === 'flow-in') {
      issues.push({ code: 'groupMemberFlowHandle', message: `协作组成员 ${line.target} 仅有上下文连接点，无流程入`, id: line.id })
    }
    // 组卡片仅 flow 连接点：矩阵（NODE_HANDLES.group 只有 flow-in/flow-out）已在
    // connectionProblem 层拦截组卡片的 ctx/db 连线（invalidHandle/handleMismatch），
    // 此处无需重复检查（避免死代码）。

    // 模式差异（§4.2.5.1）：mode1 的 start 无 ctx-out；mode1 的 end 无 ctx-in
    if (mode === 'mode1') {
      if (source && source.kind === 'start' && line.sourceHandle === 'ctx-out') {
        issues.push({ code: 'mode1StartCtxOut', message: '模式一下启动节点无上下文出（仅模式二输入节点提供）', id: line.id })
      }
      if (target && target.kind === 'end' && line.targetHandle === 'ctx-in') {
        issues.push({ code: 'mode1EndCtxIn', message: '模式一下结束节点无上下文入（仅模式二输出节点提供）', id: line.id })
      }
    }
  }

  // —— 阶段节点唯一性（§4.2.5.1 说明段：启动/输入与结束/输出各至多一个）——
  const starts = nodes.filter((n) => n.kind === 'start')
  const ends = nodes.filter((n) => n.kind === 'end')
  if (starts.length > 1) issues.push({ code: 'startUnique', message: `启动/输入节点只能存在一个（当前 ${starts.length} 个）` })
  if (ends.length > 1) issues.push({ code: 'endUnique', message: `结束/输出节点只能存在一个（当前 ${ends.length} 个）` })
  // 暂停节点仅模式一（§4.2.5.1 规则 2：模式二左侧栏不显示暂停）
  if (mode === 'mode2' && nodes.some((n) => n.kind === 'pause')) {
    issues.push({ code: 'pauseMode2', message: '模式二工作流不允许暂停节点' })
  }

  // —— 父代理唯一性（§4.2.3.1 规则 5：至多一个；模式二必须恰好一个）——
  const parents = nodes.filter((n) => n.kind === 'parent')
  if (parents.length > 1) issues.push({ code: 'parentUnique', message: `父代理节点最多一个（当前 ${parents.length} 个）` })
  if (mode === 'mode2' && parents.length === 0) {
    issues.push({ code: 'parentRequiredMode2', message: '模式二必须存在父代理节点' })
  }

  // —— 协作组成员一致性：成员 id 必须真实存在（§4.2.5.2）——
  // 幽灵组员防护：角色节点声明 groupId 指向不存在的组 id 时必须报错。
  const groupIds = new Set(nodes.filter((n) => n.kind === 'group').map((n) => n.id))
  for (const node of nodes) {
    if ((node.kind === 'parent' || node.kind === 'agent') && node.data.groupId && !groupIds.has(node.data.groupId)) {
      issues.push({ code: 'groupGhost', message: `节点 ${node.id} 声明属于协作组 ${node.data.groupId}，但该组不存在`, id: node.id })
    }
  }
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    for (const mid of node.data.memberIds ?? []) {
      const m = nodeMap.get(mid)
      if (!m) {
        issues.push({ code: 'groupMemberMissing', message: `协作组 ${node.id} 的成员 ${mid} 不存在`, id: node.id })
        continue
      }
      if (m.kind !== 'parent' && m.kind !== 'agent') {
        issues.push({ code: 'groupMemberKind', message: `协作组 ${node.id} 的成员 ${mid} 必须是角色节点`, id: node.id })
      }
    }
    // 成员节点的 groupId 与组 memberIds 双向一致
    for (const m of nodes) {
      if ((m.kind === 'parent' || m.kind === 'agent') && m.data.groupId === node.id && !(node.data.memberIds ?? []).includes(m.id)) {
        issues.push({ code: 'groupMemberMismatch', message: `节点 ${m.id} 声明属于协作组 ${node.id} 但组内无此成员`, id: m.id })
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// 归一化（保存前补全默认值，产出规范快照）
// ---------------------------------------------------------------------------

/**
 * 归一化工作流：为节点/连线补全默认值并锁定阶段节点属性。
 * 深拷贝语义（§4.2.1）：返回新对象，不改写入参；结果经 validateFlow 校验后保存。
 */
export function normalizeFlow(flow: Partial<WorkflowDocument>): WorkflowDocument {
  const mode: WorkflowMode = flow.mode === 'mode2' ? 'mode2' : 'mode1'
  const nodes: GraphNode[] = (Array.isArray(flow.nodes) ? (flow.nodes as GraphNode[]) : []).map((node) => {
    if (node.kind === 'parent' || node.kind === 'agent') {
      return {
        ...node,
        data: {
          label: node.data.label ?? '',
          systemPrompt: node.data.systemPrompt ?? '',
          provider: node.data.provider ?? '',
          model: node.data.model ?? '',
          reasoning: node.data.reasoning,
          presetId: node.data.presetId ?? null,
          retryLimit: typeof node.data.retryLimit === 'number' ? node.data.retryLimit : 3,
          reactLimit: node.data.reactLimit ?? null,
          inputSchema: node.data.inputSchema ?? '',
          outputSchema: node.data.outputSchema ?? '',
          // System Prompt 来源文件名（需求 §4.2.3.1 卡片展示）必须原样保留，
          // 否则保存后左侧栏角色卡片无法展示来源（Bug 21 字段丢失）。
          systemPromptSource: node.data.systemPromptSource,
          injectSystemPrompt: node.data.injectSystemPrompt !== false,
          injectToolSections: node.data.injectToolSections !== false,
          promptFilePath: node.data.promptFilePath ?? undefined,
          groupId: node.data.groupId ?? null,
        },
      }
    }
    if (node.kind === 'file') {
      return {
        ...node,
        data: {
          label: node.data.label ?? '',
          fileKind: node.data.fileKind ?? 'text',
          content: node.data.content ?? '',
          managedPath: node.data.managedPath,
          fileName: node.data.fileName ?? '',
          // 多选文件列表：只读契约字段（{fileName, managedPath}[]），
          // 归一化必须原样保留，否则保存后多选数据丢失（Bug 15）。
          ...(Array.isArray(node.data.files) && node.data.files.length > 0 ? { files: node.data.files } : {}),
        },
      }
    }
    if (node.kind === 'database') {
      return {
        ...node,
        data: {
          label: node.data.label ?? '',
          description: node.data.description ?? '',
          dbType: node.data.dbType ?? 'local',
          dbKind: node.data.dbKind ?? (node.data.dbType === 'server' ? 'mysql' : 'sqlite'),
          localPath: node.data.localPath,
          conn: node.data.conn,
          vectorSource: node.data.vectorSource ?? (node.data.dbType === 'local' ? 'embedding' : undefined),
        },
      }
    }
    if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
      return { ...node, data: { label: stageLabel(node.kind, mode) } }
    }
    if (node.kind === 'group') {
      return {
        ...node,
        data: {
          label: node.data.label ?? '',
          collabPrompt: node.data.collabPrompt ?? '',
          memberIds: Array.isArray(node.data.memberIds) ? node.data.memberIds : [],
          size: node.data.size ?? { w: 360, h: 240 },
        },
      }
    }
    return { ...node }
  })

  const lines: Line[] = (Array.isArray(flow.lines) ? (flow.lines as Line[]) : []).map((l) => ({ ...l }))

  return {
    id: flow.id ?? '',
    sessionId: flow.sessionId ?? '',
    mode,
    name: flow.name ?? '',
    description: flow.description ?? '',
    nodes,
    lines,
    revision: typeof flow.revision === 'number' ? flow.revision : 0,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  }
}

/**
 * 运行前完整性检查（§4.2.5.1 规则 6）：必须包含启动/输入与结束/输出节点。
 * 供 T-021 编排器启动前调用，返回缺失项（空数组=齐备），与 validateFlow 的
 * 「允许保存中间态」语义分离。
 */
export function missingStageNodes(flow: Partial<WorkflowDocument>): string[] {
  const nodes: GraphNode[] = Array.isArray(flow.nodes) ? (flow.nodes as GraphNode[]) : []
  const missing: string[] = []
  if (!nodes.some((n) => n.kind === 'start')) missing.push('start')
  if (!nodes.some((n) => n.kind === 'end')) missing.push('end')
  return missing
}
