// src/host/orchestrator/helpers.ts
//
// 编排运行时的纯函数辅助（导出供单测独立断言）：
//   - 节点/流程推导：labelOf、pauseNodeIdsOf、orchestrationNodeList、collabGroupList、
//     collabPromptOf、collabBlockOf（协作）、missingStageLabels、validateFlowForRun；
//   - 任务块组装：buildNodeBlocks（persona 任务 + 上游上下文 + 执行与交付约定）；
//   - 编排指令参数组装：directiveParams（facts 静态事实 + 末段动态态，前缀稳定）；
//   - 节点级参数解析：effectiveRetryLimitOf / effectiveReactLimitOf / effectiveThinkingOf；
//   - messageOf：错误消息提取。
// 全部为纯函数（不读时钟/随机源），不依赖全局状态。

import type { OrchestrationDirectiveParams } from '../prompts/orchestration.js'
import { buildNodeTaskBlock } from '../prompts/node-task.js'
import { buildCollabBlock } from '../prompts/collab.js'
import { ctxInEdges, dbInEdges, nodeById } from '../graph/model.js'
import { validateFlow } from '../graph/validate.js'
import type { GraphNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot } from '../shared/types.js'
import { truncateText } from './snapshot.js'
import type { RunNodeArgs } from './run-types.js'
import { WfError } from './seams.js'

/** 数据库连线提示（面向模型英文）。 */
const DB_TOOL_HINT =
  'Database nodes are connected via db-in edges. Access them only through wf_db_query: ' +
  'mode "search" (vector retrieval), mode "query" (read-only SELECT with LIMIT), mode "schema" (table structure). ' +
  'Never read database files directly.'

/** 错误消息提取（Error 或任意值）。 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
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
 * 编排指令 facts 的节点清单（仅可执行 agent 节点；父代理即编排者本人不列）。
 * 协作组是包裹层（无执行，只注入协作协议），proxy 镜像主节点 agent id 相同，
 * 阶段/文件/数据库均非可执行节点——一律不列入待编排节点（用户批注，图3）。
 * 协作组并行说明见 collabGroupList（单独成段，不并入节点清单）。
 */
export function orchestrationNodeList(flow: WorkflowDocument): Array<{ id: string; label: string }> {
  return flow.nodes
    .filter((n) => n.kind === 'agent')
    .map((n) => ({ id: n.id, label: labelOf(n) }))
}

/** 编排指令 facts 的协作组说明（组内成员并行启动提示）。 */
export function collabGroupList(flow: WorkflowDocument): Array<{ groupId: string; label: string; memberIds: string[] }> {
  return flow.nodes
    .filter((n) => n.kind === 'group')
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

/** 节点任务块组装：persona 任务 + 输入输出结构 + 上下文注入 + 执行与交付约定。 */
export function buildNodeBlocks(input: {
  flow: WorkflowDocument
  node: RoleNode
  /** 运行快照：上游角色节点最终产出（ctx 连线显式注入）的读取源。 */
  snapshot: RunSnapshot
  documentTextLimit: number
  pauseNodeIds: string[]
  retryLimit: number
  reactLimit: number | undefined
  runContextText: string
}): Array<{ type: 'text'; text: string }> {
  const { flow, node } = input
  const data = node.data
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
  const dbHint = dbInEdges(flow, node.id).length > 0 ? DB_TOOL_HINT : ''

  const text = buildNodeTaskBlock({
    facts: {
      task: data.systemPrompt ?? '',
      nodeLabel: data.label || node.id,
      upstreamContext,
      filePaths,
      dbToolHint: dbHint,
      toolAllowlistNote: '', // 工具白名单解析后填充
    },
    dynamic: {
      retryLimit: input.retryLimit,
      ...(input.reactLimit !== undefined ? { reactLimit: input.reactLimit } : {}),
      pauseNodeIds: input.pauseNodeIds,
      runContextText: input.runContextText,
    },
  })
  // 协作组成员：把成员清单块（含成员 ID + 角色名 + 自定义说明）追加到首条用户消息。
  // 需求变更：协作信息不再作为系统提示词段注入，改为注入用户消息。
  const collabBlock = collabBlockOf(flow, node.id)
  return [{ type: 'text', text: collabBlock ? `${text}\n\n${collabBlock}` : text }]
}

/** 编排指令参数组装（facts 静态事实 + dynamic 末段动态态，前缀稳定）。 */
export function directiveParams(
  flow: WorkflowDocument,
  defPath: string,
  mode: 'mode1' | 'mode2',
  extra?: {
    /** 断点继续事实（resumeRun 用）。 */
    resume?: { resumeFromNodeId?: string; resumedFromRunId: string }
    /** 模式二用户问题（不稳定内容，仅末段）。 */
    question?: string
  },
): OrchestrationDirectiveParams {
  return {
    facts: {
      workflowName: flow.name ?? flow.id,
      workflowGoal: flow.description ?? '',
      definitionPath: defPath,
      nodes: orchestrationNodeList(flow),
      collabGroups: collabGroupList(flow),
    },
    dynamic: {
      pauseNodeIds: pauseNodeIdsOf(flow),
      runParamsText:
        mode === 'mode2'
          ? 'mode2 (service): use wf_run_node_wait to start each node and block until it finishes; never use wf_run_node.'
            : 'mode1 (orchestration): use wf_run_node to start each node asynchronously; never use wf_run_node_wait.',
      ...(extra?.question ? { question: extra.question } : {}),
      ...(extra?.resume
        ? { isResume: true, resumeFromNodeId: extra.resume.resumeFromNodeId, resumedFromRunId: extra.resume.resumedFromRunId }
        : {}),
    },
  }
}

/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
export function effectiveRetryLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number {
  const fromArgs = Number(args?.retryLimit)
  if (Number.isFinite(fromArgs) && fromArgs >= 0) return fromArgs
  const fromNode = Number(node.data?.retryLimit)
  if (Number.isFinite(fromNode) && fromNode >= 0) return fromNode
  return fallback
}

/** 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认。 */
export function effectiveReactLimitOf(node: RoleNode, args: RunNodeArgs, fallback: number): number | undefined {
  const fromArgs = Number(args?.iterationLimit)
  if (Number.isFinite(fromArgs) && fromArgs >= 1) return fromArgs
  const fromNode = node.data?.reactLimit
  if (fromNode === null) return undefined // 节点显式不设限（V-01）
  const numeric = Number(fromNode)
  if (Number.isFinite(numeric) && numeric >= 1) return numeric
  return fallback
}

/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
export function effectiveThinkingOf(node: RoleNode, args: RunNodeArgs): string | undefined {
  const fromArgs = args?.thinking
  if (typeof fromArgs === 'string' && fromArgs.trim()) return fromArgs
  const fromNode = node.data?.reasoning
  return typeof fromNode === 'string' && fromNode.trim() ? fromNode : undefined
}
