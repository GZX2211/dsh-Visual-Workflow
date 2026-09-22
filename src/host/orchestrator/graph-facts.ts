// src/host/orchestrator/graph-facts.ts
//
// 图推导与节点上下文「事实」纯函数（供运行时与单测共用）：
//   - 节点/流程推导：labelOf、pauseNodeIdsOf、orchestrationNodeList、collabGroupList、
//     collabPromptOf、collabBlockOf（协作成员清单块）；
//   - 运行前完整性：missingStageLabels、validateFlowForRun；
//   - 节点执行上下文事实：dbToolHintOf、buildNodeContextFacts（上游产出/文件路径/db 提示）。
// 全部为纯函数（不读时钟/随机源），不依赖全局状态。

import { buildCollabBlock } from '../prompts/index.js'
import { ctxInEdges, dbInEdges, nodeById, nodeParticipatesInFlow, validateFlow } from '../graph/index.js'
import type { DatabaseNode, GraphNode, GroupNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot } from '../shared/types.js'
import { truncateText } from './snapshot.js'
import { WfError } from './errors.js'

/** 数据库访问工具的使用说明（面向模型中文，精简；不随节点变化的三模式描述部分。工具名保留英文 W-03）。 */
const DB_TOOL_HINT_MODES =
  '只可通过 wf_db_query 访问：mode "search"（向量检索）、mode "query"（只读 SELECT，带 LIMIT）、mode "schema"（表结构）；禁止直接读取数据库文件。'

/**
 * 生成某节点的数据库工具说明。
 * - 存在 db-in 连线时，返回包含所连数据节点 id 与 label 的提示——子代理必须把该 id
 *   作为 wf_db_query 的 dataId 传入（BUG 修复：此前提示未携带 id，子代理无法定位数据源，
 *   只能用猜测的 id → WF_DB_BAD_DATA）。
 * - 无 db-in 连线时返回空串（工具白名单也不注入 wf_db_query）。
 * 纯函数：输入同则输出同，不读时钟/随机源。
 */
export function dbToolHintOf(flow: WorkflowDocument, nodeId: string): string {
  const sources = dbInEdges(flow, nodeId)
    .map((line) => nodeById(flow, line.source))
    .filter((n): n is DatabaseNode => n?.kind === 'database')
  if (sources.length === 0) return ''
  const ids = sources.map((n) => `${n.id} (${labelOf(n)})`).join('; ')
  return `已连接数据库节点：${ids}。${DB_TOOL_HINT_MODES}`
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
 * 编排指令 facts 的节点清单（仅可执行且参与流程的 agent 节点；父代理即编排者本人不列）。
 * 「参与流程」判定：节点自身或其虚拟节点作为任一流程线（flow-out/flow-in）的源/目标；
 * 未参与流程的 agent 节点 = 用户批注的「不执行任务的无关节点」，不进入清单。
 * 协作组是包裹层（无执行，只注入协作协议），proxy 镜像主节点 agent id 相同，
 * 阶段/文件/数据库均非可执行节点——一律不列入待编排节点（用户批注，图3）。
 * 协作组并行说明见 collabGroupList（单独成段，不并入节点清单）。
 */
export function orchestrationNodeList(flow: WorkflowDocument): Array<{ id: string; label: string }> {
  return flow.nodes
    .filter((n) => n.kind === 'agent' && nodeParticipatesInFlow(flow, n.id))
    .map((n) => ({ id: n.id, label: labelOf(n) }))
}

/** 编排指令 facts 的协作组说明（组内成员并行启动提示；仅列参与流程的协作组卡片）。 */
export function collabGroupList(flow: WorkflowDocument): Array<{ groupId: string; label: string; memberIds: string[] }> {
  return flow.nodes
    .filter((n): n is GroupNode => n.kind === 'group' && nodeParticipatesInFlow(flow, n.id))
    .map((n) => ({ groupId: n.id, label: n.data.label || n.id, memberIds: n.data.memberIds ?? [] }))
}

/** 读取某角色节点所属协作组的协作 Prompt（组卡片 data.collabPrompt；非组内成员返回空串）。 */
export function collabPromptOf(flow: WorkflowDocument, nodeId: string): string {
  const group = flow.nodes.find(
    (n): n is GraphNode & { data: { collabPrompt?: string; memberIds?: string[] } } =>
      n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(nodeId),
  )
  return group ? String(group.data.collabPrompt ?? '').trim() : ''
}

/**
 * 构建某角色节点的协作成员清单块（追加到其首条用户消息）。
 * 始终列出本组全部成员（id + 角色名，告知协作对象与可发消息对象），再追加自定义协作说明。
 * 非组内成员返回空串（不注入）。
 */
export function collabBlockOf(flow: WorkflowDocument, nodeId: string): string {
  const group = flow.nodes.find(
    (n): n is GraphNode & { data: { collabPrompt?: string; memberIds?: string[] } } =>
      n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(nodeId),
  )
  if (!group) return ''
  const members = (group.data.memberIds ?? []).map((id) => {
    const member = nodeById(flow, id)
    return { id, label: member ? labelOf(member) : id }
  })
  return buildCollabBlock({ members, custom: String(group.data.collabPrompt ?? '') })
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
 */
export function buildNodeContextFacts(input: {
  flow: WorkflowDocument
  node: RoleNode
  /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
  snapshot: RunSnapshot
  documentTextLimit: number
}): { upstreamContext: Array<{ source: string; content: string }>; filePaths: string[]; dbToolHint: string } {
  const { flow, node } = input
  // 上游上下文（ctx-in 显式连线）：
  //   - file 节点：文本直通（截断）/ 受管文件路径索引；
  //   - agent/parent 角色节点（含虚拟节点引用）：注入运行快照中该节点的最终
  //     产出（status=ok/react-capped，截断；其余状态无产出不注入）——需求
  //     明确「上游最终输出作为上下文传入下游；不连接则不传」。
  const upstreamContext: Array<{ source: string; content: string }> = []
  const filePaths: string[] = []
  for (const edge of ctxInEdges(flow, node.id)) {
    const src = nodeById(flow, edge.source)
    if (!src) continue
    if (src.kind === 'file') {
      if (src.data.fileKind === 'text' && String(src.data.content ?? '').trim()) {
        upstreamContext.push({
          source: src.data.label ?? src.id,
          content: truncateText(src.data.content, input.documentTextLimit),
        })
      } else {
        // 受管文件路径索引（需求 §4.2.4.1：文本直通，非文本文件注入路径索引）：
        // 单选 managedPath 与多选 files 列表都要注入——多选配置下 managedPath 通常
        // 为空、路径存在 files 数组中，只认单字段会导致下游收不到任何文件索引（Bug 21）。
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
      continue
    }
    // 模式二输入节点：右出 ctx 连线显式传递用户问题（快照已预填产出）
    if (src.kind === 'start') {
      if (flow.mode !== 'mode2') continue
      const entry = input.snapshot.nodes.find((n) => n.nodeId === src.id)
      if (!entry || entry.status !== 'ok') continue
      const output = String(entry.output ?? '').trim()
      if (!output) continue
      upstreamContext.push({
        source: labelOf(src),
        content: truncateText(output, input.documentTextLimit),
      })
      continue
    }
    // 角色/虚拟节点：解析主节点后查快照产出（快照按主节点 key 记账）
    const resolved = src.kind === 'proxy' ? nodeById(flow, src.proxySourceId) : src
    if (!resolved || (resolved.kind !== 'agent' && resolved.kind !== 'parent')) continue
    const entry = input.snapshot.nodes.find((n) => n.nodeId === resolved.id)
    if (!entry || (entry.status !== 'ok' && entry.status !== 'react-capped')) continue
    const output = String(entry.output ?? '').trim()
    if (!output) continue
    upstreamContext.push({
      source: labelOf(src),
      content: truncateText(output, input.documentTextLimit),
    })
  }
  return { upstreamContext, filePaths, dbToolHint: dbToolHintOf(flow, node.id) }
}
