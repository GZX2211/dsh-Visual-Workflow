// src/host/orchestrator/snapshot.ts
//
// 运行快照纯函数（T-021）：创建/更新/终态化/截断/最终文本提取。
//
// 上下文：run 快照（RunSnapshot，shared/types.ts）是一次运行的全量持久化状态，
//       亦是断点（§4.7）与运行历史面板的数据源。本文件只放纯函数——不读时钟以外的
//       全局、不碰存储、不依赖运行时，便于状态机单测逐函数断言（T-021 DoD）。
//
// 语义依据（需求文档 §4.7）：
//   - 节点输出记录：完整输出（默认上限 100KB，outputFullLimit 配置）用于断点/上下文
//     传递；界面展示截断摘要（默认 6000 字，OUTPUT_SUMMARY_LIMIT）。
//   - 节点状态：pending/running/ok/fail/skipped/react-capped（架构文档 §6.1；
//     NodeRunStatus 词表内没有 stopped——被停止的运行以 run 级状态区分，运行中
//     被打断的节点收敛为 fail：非 ok 即不继承，续跑时重试，语义精确）。
//
// 为什么终态化把 running 收敛为 fail 而不是 skipped（§4.7 规则 6）：skipped 语义
// 是「从未执行」，被终止时正在执行的节点已消耗一次尝试且产出不可信，必须重跑；
// 只有从未启动的 pending 才记 skipped。

import type { WorkflowDocument } from '../shared/graph-model.js'
import type { NodeRunStatus, RunSnapshot, RunStatus } from '../shared/types.js'

/** 输出摘要截断上限（字符，架构文档 §6.1 nodes[].outputSummary；需求 §4.7 规则 7）。 */
export const OUTPUT_SUMMARY_LIMIT = 6000

/** 节点完整输出兜底截断上限（config.outputFullLimit 缺省时使用）。 */
const DEFAULT_OUTPUT_FULL_LIMIT = 102400

/** run 状态中文文案（错误提示/历史面板共用）。 */
export function statusText(status: RunStatus): string {
  switch (status) {
    case 'running': return '运行中'
    case 'paused': return '已暂停'
    case 'completed': return '完成'
    case 'failed': return '失败'
    case 'stopped': return '已停止'
    case 'interrupted': return '已中断'
    /* v8 ignore next 2 -- 判别联合穷尽，防御未来词表扩展 */
    default: return String(status)
  }
}

/** 文本截断：超限时保留前缀并追加中文截断标记（与旧项目 truncate 同语义）。 */
export function truncateText(text: unknown, limit: number): string {
  const value = String(text ?? '')
  return value.length > limit ? `${value.slice(0, limit)}…（已截断）` : value
}

/**
 * 创建全新 run 快照（§6.1 逐字段）：全部节点 pending、attempts 0、无输出。
 * 断点字段（resumedFromRunId/resumeFromNodeId）由续跑任务（T-027）回填。
 */
export function createRunSnapshot(input: {
  /** run 稳定标识。 */
  runId: string
  /** 起始工作流（节点清单来源；节点快照=全量节点）。 */
  flow: WorkflowDocument
  /** 归属会话。 */
  sessionId: string
  /** 运行模式。 */
  mode: 'mode1' | 'mode2'
  /** 时钟注入（测试可控；缺省 Date.now）。 */
  now?: number
}): RunSnapshot {
  const startedAt = new Date(input.now ?? Date.now()).toISOString()
  return {
    id: input.runId,
    flowId: input.flow.id,
    flowName: input.flow.name ?? input.flow.id,
    sessionId: input.sessionId,
    mode: input.mode,
    status: 'running',
    startedAt,
    endedAt: null,
    summary: '',
    nodes: (input.flow.nodes ?? []).map((node) => ({
      nodeId: node.id,
      status: 'pending' as const,
      attempts: 0,
      startedAt: null,
      endedAt: null,
      output: '',
      outputSummary: '',
    })),
  }
}

/** setNodeStatus 的可选参数（全部缺省即纯状态切换）。 */
export interface SetNodeStatusOptions {
  /** 覆盖尝试计数（wf_run_node 每次调用递增）。 */
  attempts?: number
  /** 节点完整输出（status='ok' 时写入：完整输出截断到 outputFullLimit、摘要截断到 6000 字）。 */
  output?: string
  /** 完整输出持久化字节上限（缺省 100KB）。 */
  outputFullLimit?: number
  /** 时钟注入（时间戳字段用）。 */
  now?: number
}

/**
 * 更新快照中某节点的运行状态（与旧项目 setNodeStatus 同语义）：
 *   - running 且无 startedAt → 补开始时间；
 *   - ok/fail/skipped/react-capped 且无 endedAt → 补结束时间；
 *   - ok 同时回写完整输出（output）与展示摘要（outputSummary）。
 */
export function setNodeStatus(snapshot: RunSnapshot, nodeId: string, status: NodeRunStatus, options: SetNodeStatusOptions = {}): void {
  const entry = snapshot.nodes.find((node) => node.nodeId === nodeId)
  if (!entry) return
  const now = options.now ?? Date.now()
  entry.status = status
  if (options.attempts !== undefined) entry.attempts = options.attempts
  if (status === 'ok') {
    const text = String(options.output ?? '')
    entry.output = truncateText(text, options.outputFullLimit ?? DEFAULT_OUTPUT_FULL_LIMIT)
    entry.outputSummary = truncateText(text, OUTPUT_SUMMARY_LIMIT)
  }
  if (status === 'running' && !entry.startedAt) entry.startedAt = new Date(now).toISOString()
  if (status === 'ok' || status === 'fail' || status === 'skipped' || status === 'react-capped') {
    if (!entry.endedAt) entry.endedAt = new Date(now).toISOString()
  }
}

/**
 * 终态化节点清单（运行收尾/终止时调用）：从未启动的 pending → skipped，
 * 正在执行的 running → fail（非 ok 不继承，续跑时重试，见文件头语义说明）。
 */
export function terminalizeNodes(snapshot: RunSnapshot, now?: number): void {
  const endedAt = new Date(now ?? Date.now()).toISOString()
  for (const node of snapshot.nodes) {
    if (node.status === 'pending') node.status = 'skipped'
    else if (node.status === 'running') {
      node.status = 'fail'
      if (!node.endedAt) node.endedAt = endedAt
    }
  }
}

/** 深拷贝快照（对外只读查询用，防调用方改写内部状态）。 */
export function cloneSnapshot(snapshot: RunSnapshot): RunSnapshot {
  return structuredClone(snapshot)
}

/**
 * 从官方 subagent/end 的 lastAssistantMessage（ContentBlock[]）提取纯文本。
 * 只认 { type: 'text', text } 块（官方 §8 #21 取证）；limit 为 0/负值时不截断。
 */
export function lastAssistantText(blocks: unknown, limit: number): string {
  const text = (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      const value = block as { type?: unknown; text?: unknown } | null
      return value && value.type === 'text' ? String(value.text ?? '') : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!text) return ''
  return limit > 0 ? truncateText(text, limit) : text
}
