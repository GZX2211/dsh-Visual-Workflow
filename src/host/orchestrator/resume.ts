// src/host/orchestrator/resume.ts
//
// 断点续跑纯函数与类型：恢复候选查找 + 继承快照构建。
//
// 续跑语义：
//   - 仅 paused / interrupted 状态的 run 可恢复（暂停门触发或宿主重启中断）；
//   - 每次续跑生成一条新 run 记录（resumedFromRunId 追溯继承链），旧记录保持原状；
//   - 节点快照 = 全量节点：已 ok/react-capped 节点继承状态与完整输出（resumed 标记，
//     不重跑），其余节点（含被中断时 running 的）统一回退 pending 重新执行；
//   - 断点产出随继承快照重新可用，后续节点的 ctx 连线注入直接用新快照（已 ok 节点
//     的 output 字段）——无需额外回填通道。

import type { FlowStore } from '../storage/flow-store.js'
import type { WorkflowDocument } from '../shared/graph-model.js'
import type { NodeRunStatus, RunSnapshot } from '../shared/types.js'

/** 可恢复的 run 状态集合（paused=暂停门断点；interrupted=宿主重启中断）。 */
const RESUMABLE_STATUSES = ['paused', 'interrupted'] as const

/** 断点续跑入参（runResume 端点与 run 端点自动续跑共用）。 */
export interface ResumeInput {
  sessionId: string
  flowId: string
  /** 指定恢复的旧 run id；缺省取该工作流最近的可恢复记录。 */
  fromRunId?: string
}

/** 断点续跑结果。 */
export interface ResumeResult {
  runId: string
  /** 流程事实源文件绝对路径（编排指令 facts.definitionPath）。 */
  defPath: string
  /** 实际恢复的旧 run id。 */
  resumedFromRunId: string
}

/**
 * 查找可恢复的 run：
 *   - fromRunId 指定：磁盘记录必须存在且归属会话/工作流匹配且状态可恢复；
 *   - 未指定：该工作流最近（startedAt 倒序）的可恢复记录。
 * 查无返回 null（由调用方区分「无断点」与「指定 run 不可恢复」两类语义）。
 */
export async function findResumableRun(
  store: FlowStore,
  input: ResumeInput,
): Promise<RunSnapshot | null> {
  if (input.fromRunId) {
    const run = await store.getRun(input.fromRunId)
    if (!run) return null
    if (run.sessionId !== input.sessionId || run.flowId !== input.flowId) return null
    return isResumable(run) ? run : null
  }
  const runs = await store.listRuns(input.flowId)
  return runs.find((run) => run.sessionId === input.sessionId && isResumable(run)) ?? null
}

/** 状态是否可恢复。 */
function isResumable(run: RunSnapshot): boolean {
  return (RESUMABLE_STATUSES as readonly string[]).includes(run.status)
}

/**
 * 构建继承快照（纯函数）：
 *   - 节点清单以「当前工作流」为准（恢复前画布可能已编辑）；
 *   - 旧 run 中 ok/react-capped 的节点继承状态、完整输出与摘要（resumed=true）；
 *   - 其余节点回退 pending（attempts/时间戳/输出清零），恢复后重新执行；
 *   - 断点字段：resumedFromRunId 追溯链、resumeFromNodeId 续跑起点。
 */
export function buildResumedSnapshot(input: {
  prev: RunSnapshot
  runId: string
  flow: WorkflowDocument
  sessionId: string
  mode: 'mode1' | 'mode2'
  now?: number
}): RunSnapshot {
  const { prev, runId, flow, sessionId, mode } = input
  const now = input.now ?? Date.now()
  const prevByNode = new Map(prev.nodes.map((node) => [node.nodeId, node]))
  // 续跑起点（Bug 21）：暂停断点继承 prev.resumeFromNodeId（暂停节点 id）；
  // interrupted（宿主重启中断）时 prev 无暂停点，推断为「首个未完成节点」
  // （已 ok/react-capped 节点继承后不重跑，恢复从这里继续），避免起点不明确。
  const resumeFromNodeId = prev.resumeFromNodeId
    ?? flow.nodes.find((node) => {
      const prevNode = prevByNode.get(node.id)
      return !prevNode || (prevNode.status !== 'ok' && prevNode.status !== 'react-capped')
    })?.id
  const nodes = (flow.nodes ?? []).map((node) => {
    const prevNode = prevByNode.get(node.id)
    if (prevNode && (prevNode.status === 'ok' || prevNode.status === 'react-capped')) {
      return {
        nodeId: node.id,
        status: prevNode.status as NodeRunStatus,
        attempts: prevNode.attempts,
        startedAt: prevNode.startedAt,
        endedAt: prevNode.endedAt,
        output: prevNode.output,
        outputSummary: prevNode.outputSummary,
        resumed: true,
      }
    }
    return {
      nodeId: node.id,
      status: 'pending' as const,
      attempts: 0,
      startedAt: null,
      endedAt: null,
      output: '',
      outputSummary: '',
    }
  })
  return {
    id: runId,
    flowId: flow.id,
    flowName: flow.name ?? flow.id,
    sessionId,
    mode,
    status: 'running',
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    summary: '',
    resumedFromRunId: prev.id,
    resumeFromNodeId,
    nodes,
  }
}
