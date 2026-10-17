// src/host/orchestrator/graph-facts.ts
//
// 图推导与节点上下文「事实」纯函数（供运行时与单测共用）：
//   - 节点/流程推导：labelOf、pauseNodeIdsOf、orchestrationNodeList、collabGroupList、
//     collabPromptOf、commTargetsOf（可通信对象清单）；
//   - 运行前完整性：missingStageLabels、validateFlowForRun；
//   - 节点执行上下文事实：dbToolHintOf、buildNodeContextFacts（上游产出/文件路径/db 提示）。
// 全部为纯函数（不读时钟/随机源），不依赖全局状态。

import { isEnglishSystemLanguage } from '../system-language.js'
import { renderTemplate, RULE_DB_TOOL, RULE_DB_TOOL_EN, type CommTarget } from '../prompts/index.js'
import { autoContextSourceIds, ctxInEdges, dbInEdges, nodeById, nodeParticipatesInFlow, validateFlow } from '../graph/index.js'
import type { DatabaseNode, GraphNode, GroupNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot } from '../shared/types.js'
import { PARENT_TARGET } from './send-message-protocol.js'
import { hasProducedOutput, truncateText } from './snapshot.js'
import { WfError } from './errors.js'

/**
 * 生成某节点的数据库工具说明（正文见 prompts/texts/rule-db-tool.ts）。
 * - 存在 db-in 连线时，返回包含所连数据节点 id 与 label 的提示——子代理必须把该 id
 *   作为 wf_db_query 的 dataId 传入（BUG 修复：此前提示未携带 id，子代理无法定位数据源，
 *   只能用猜测的 id → WF_DB_BAD_DATA）。
 * - 无 db-in 连线时返回空串（工具白名单也不注入 wf_db_query）。
 * 纯函数：输入同则输出同，不读时钟/随机源。
 */
export function dbToolHintOf(flow: WorkflowDocument, nodeId: string, systemLanguage?: string): string {
  const sources = dbInEdges(flow, nodeId)
    .map((line) => nodeById(flow, line.source))
    .filter((n): n is DatabaseNode => n?.kind === 'database')
  if (sources.length === 0) return ''
  const ids = sources.map((n) => `${n.id} (${labelOf(n)})`).join('; ')
  return renderTemplate(isEnglishSystemLanguage(systemLanguage) ? RULE_DB_TOOL_EN : RULE_DB_TOOL, { sources: ids })
}

/** 节点人类可读名称（提示语与错误消息用）。 */
export function labelOf(node: GraphNode): string {
  if (node.kind === 'proxy') return node.id
  if (node.kind === 'parent' || node.kind === 'agent') return node.data.label || node.id
  if (node.kind === 'group') return node.data.label || node.id
  if (node.kind === 'file' || node.kind === 'database') return node.data.label || node.id
  return node.data.label
}

/** 流程中的暂停节点 id 清单（编排指令与节点任务块动态态共用）。 */
export function pauseNodeIdsOf(flow: WorkflowDocument): string[] {
  return flow.nodes.filter((n) => n.kind === 'pause').map((n) => n.id)
}

/**
 * 参与流程的可调度 agent 节点清单（catalog 的 `schedulable` 与编排调度口径的等价参照）。
 *
 * 编排指令**不再内联节点清单**：拓扑只经 wf_org_catalog 的 instance 通道召回，父代理自行读取
 * 每个节点的 schedulable 标记。本函数保留为「可调度单元」这一口径的唯一可测表达。
 * 「参与流程」判定：节点自身或其虚拟节点作为任一流程线（flow-out/flow-in）的源/目标；
 * 未参与流程的 agent 节点 = 用户批注的「不执行任务的无关节点」，不进入清单。
 * Team 卡片是包裹层（不是执行主体），proxy 镜像主节点 agent id 相同，
 * 阶段/文件/数据库均非可执行节点——一律不列入。
 */
export function orchestrationNodeList(flow: WorkflowDocument): Array<{ id: string; label: string }> {
  return flow.nodes
    .filter((n) => n.kind === 'agent' && nodeParticipatesInFlow(flow, n.id))
    .map((n) => ({ id: n.id, label: labelOf(n) }))
}

/**
 * 编排指令 facts 的 Team 说明（Team 卡片 + 成员节点 id；仅列参与流程的 Team 卡片）。
 * Team 卡片只标出团队的执行位置，父代理按此逐个调度其成员节点（Team 卡片本身不可作为调度目标）。
 */
export function collabGroupList(flow: WorkflowDocument): Array<{ groupId: string; label: string; memberIds: string[] }> {
  return flow.nodes
    .filter((n): n is GroupNode => n.kind === 'group' && nodeParticipatesInFlow(flow, n.id))
    .map((n) => ({ groupId: n.id, label: n.data.label || n.id, memberIds: n.data.memberIds ?? [] }))
}

/** 读取某角色节点所属 Team 的协作 Prompt（Team 卡片 data.collabPrompt；非组内成员返回空串）。 */
export function collabPromptOf(flow: WorkflowDocument, nodeId: string): string {
  const group = flow.nodes.find(
    (n): n is GraphNode & { data: { collabPrompt?: string; memberIds?: string[] } } =>
      n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(nodeId),
  )
  return group ? String(group.data.collabPrompt ?? '').trim() : ''
}

/**
 * 某节点的可通信对象清单（注入子代理任务块的「可通信对象」段）。
 *
 * 组成（用户裁决 2026-10）：父代理固定别名 + 本组其他成员节点；非组内成员只有父代理。
 * 上下游节点的 id 不进本清单——可通信面只由组关系决定，不由数据流决定。
 * 不列节点自身：wf_send_message 拒绝自投，列出只会误导模型。
 */
export function commTargetsOf(flow: WorkflowDocument, nodeId: string, systemLanguage?: string): CommTarget[] {
  const targets: CommTarget[] = [{ label: isEnglishSystemLanguage(systemLanguage) ? 'Parent' : '父代理', id: PARENT_TARGET }]
  const group = flow.nodes.find(
    (n): n is GroupNode => n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(nodeId),
  )
  if (!group) return targets
  for (const id of group.data.memberIds ?? []) {
    if (id === nodeId) continue
    const member = nodeById(flow, id)
    targets.push({ label: member ? labelOf(member) : id, id })
  }
  return targets
}

/** 运行前完整性检查：缺失的启动/结束节点（按模式渲染中文名）。 */
export function missingStageLabels(flow: WorkflowDocument): string[] {
  const labels: string[] = []
  if (!flow.nodes.some((n) => n.kind === 'start')) labels.push(flow.mode === 'mode2' ? '输入' : '启动')
  if (!flow.nodes.some((n) => n.kind === 'end')) labels.push(flow.mode === 'mode2' ? '输出' : '结束')
  return labels
}

/** 运行前校验（防御：保存时已校验，此处拦截非法快照）。 */
export function validateFlowForRun(flow: WorkflowDocument): WfError | null {
  const validation = validateFlow(flow)
  if (!validation.ok) {
    return new WfError(`工作流校验未通过：${validation.issues[0]?.message ?? '未知问题'}`, 'WF_FLOW_INVALID')
  }
  return null
}

/**
 * 节点执行上下文组装（纯函数）：上游产出 / 文件路径索引 / 数据库工具说明。
 * buildNodeBlocks（子代理任务块）与 prepareParentExecutor（父代理执行单元）共用，
 * 保证同一节点的上下文注入完全一致。
 *
 * 上游来源有两条（用户裁决 2026-10）：
 *   - 数据源：file 节点经 ctx 出线注入的文本（截断直通）或受管文件路径索引——
 *     file 无流程线，只能靠手动连线，故该通道保留；
 *   - 流程前驱产出：全链路自动注入（autoContextSourceIds），无需手动连线。
 * 角色节点之间的旧 ctx 交接线已停用（静默忽略）；Team 与上下游解耦，不参与注入。
 */
export function buildNodeContextFacts(input: {
  flow: WorkflowDocument
  node: RoleNode
  /** 运行快照：上游角色节点最终产出（自动注入）的读取源。 */
  snapshot: RunSnapshot
  documentTextLimit: number
  systemLanguage?: string
}): { upstreamContext: Array<{ nodeId: string; source: string; content: string }>; filePaths: string[]; dbToolHint: string } {
  const { flow, node } = input
  const upstreamContext: Array<{ nodeId: string; source: string; content: string }> = []
  const filePaths: string[] = []

  // ① 数据源：file 节点的 ctx 出线（文本直通 / 受管文件路径索引）。
  //    技术债（ctx-out 停用）：角色节点（agent/parent/proxy）的 ctx 出线已不再是注入来源，
  //    故此处只认 file 来源；角色来源的旧线静默忽略（不报错、不迁移）。
  //    需求 §4.2.4.1：文本直通，非文本文件注入路径索引——单选 managedPath 与多选
  //    files 列表都要注入：多选配置下 managedPath 通常为空、路径存在 files 数组中，
  //    只认单字段会导致下游收不到任何文件索引（Bug 21）。
  for (const edge of ctxInEdges(flow, node.id)) {
    const src = nodeById(flow, edge.source)
    if (!src || src.kind !== 'file') continue
    if (src.data.fileKind === 'text' && String(src.data.content ?? '').trim()) {
      upstreamContext.push({
        nodeId: src.id,
        source: src.data.label ?? src.id,
        content: truncateText(src.data.content, input.documentTextLimit),
      })
      continue
    }
    const seen = new Set(filePaths)
    if (src.data.managedPath) {
      filePaths.push(src.data.managedPath)
      seen.add(src.data.managedPath)
    }
    for (const item of src.data.files ?? []) {
      const p = String(item?.managedPath ?? '').trim()
      if (p && !seen.has(p)) {
        filePaths.push(p)
        seen.add(p)
      }
    }
  }

  // ② 流程前驱产出（自动注入）：直接前驱按流程线声明顺序；无产出的阶段节点已在来源枚举里跳过。
  //    armed 必须算数：Team 成员回合结束即落 armed，排除它会使其产出永远传不到下游
  //    （组内信息静默断链）。判定与产出回写共用 snapshot.hasProducedOutput。
  for (const sourceId of autoContextSourceIds(flow, node.id)) {
    const src = nodeById(flow, sourceId)
    if (!src) continue
    // 模式一的启动节点没有产出语义（模式二输入节点的产出即本次用户问题）
    if (src.kind === 'start' && flow.mode !== 'mode2') continue
    const entry = input.snapshot.nodes.find((n) => n.nodeId === sourceId)
    if (!entry || !hasProducedOutput(entry.status)) continue
    const output = String(entry.output ?? '').trim()
    if (!output) continue
    upstreamContext.push({
      nodeId: sourceId,
      source: labelOf(src),
      content: truncateText(output, input.documentTextLimit),
    })
  }
  return { upstreamContext, filePaths, dbToolHint: dbToolHintOf(flow, node.id, input.systemLanguage ?? input.snapshot.systemLanguage) }
}
