// src/host/prompts/orchestration.ts
//
// 编排指令模板构建器（T-005 基线之一）。
//
// 上下文：本指令文本由编排器在 startRun 时一次性 followup 注入「父代理」主会话，
//       指导父代理按 流程事实源（orchestrations/<runId>.json）自主调度节点子代理、
//       判断条件连线、并在失控或正常走完时 wf_finish 收尾。模板措辞参考旧项目
//       VisualWorkflow/lib/orchestrator.js 的 buildOrchestrationCommand（L246-286）
//       骨架，但按架构文档 §13.1 重构为「前缀稳定 + 关键约束双位 + 动态值仅注入末尾」。
//
// 稳定布局（§13.1）：
//   ① 首段 = 硬约束（仅调度不执行 / wf_run_node 异步 / wf_finish 幂等收尾 / 失败语义 /
//            条件连线由父代理语义判断 / 空载与调用上限护栏 / 失控立即 wf_finish(failed)）
//   ② 中段 = 过程性信息（事实源路径 / 节点清单 / 协作组并行说明）
//   ③ 末段 = 关键约束重申 + 本次动态状态（断点继续 / 暂停 / 运行参数等动态值仅在此注入）
//
// 为什么动态值只在末段（§13.1.1 前缀稳定 / KV 缓存友好）：同一 run 内本模板字符串
// 整体固定，动态状态（当前进度 / 运行参数）若插入前中段会破坏 KV 缓存前缀；单独成
// 尾段则中前段字节稳定。构建器为纯函数：不读 Date.now/随机源，同一 params 两次构建
// 字节相同，仅当末段动态字段变化时输出尾段才变化。

import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js'

/**
 * 编排指令模板的入参（中文注释每个字段，供后续组装任务直接引用）。
 * 结构说明：`facts` 是同一 run 内字节稳定的静态事实；`dynamic` 是仅注入末段的
 *           动态状态（断点继续 / 暂停 / 运行参数等不稳定内容）。
 */
export interface OrchestrationDirectiveParams {
  /** 工作流流程定义文件路径（事实源，只读），如 orchestrations/<runId>.json */
  facts: {
    /**
     * 工作流名称（人类可读标题，注入节点清单标题）。
     */
    workflowName: string
    /**
     * 工作流目标描述；可为空字符串（模板以占位文本呈现）。
     */
    workflowGoal: string
    /**
     * 流程事实源文件路径（父代理需 read 的只读 JSON 路径）。
     */
    definitionPath: string
    /**
     * 节点清单：流程中可调度执行的角色/协作单元（id + 人类可读名称）。
     * 供父代理在「收到完成汇报后按连线推进」时定位上游/下游；不含连线语义，
     * 完整拓扑在事实源文件内。
     */
    nodes: Array<{ id: string; label: string }>
    /**
     * 协作组成员并行说明：每个协作组的成员节点 id 列表。
     * 用于中段提示父代理「组卡片 flow-in 触发时对成员逐个 wf_run_node 并行启动，
     * 组内经 wf_ask_agent 阻塞通信，全部 ok 后组卡片记为 ok 并从其 flow-out 继续」。
     */
    collabGroups: Array<{ groupId: string; label: string; memberIds: string[] }>
  }
  /**
   * 末段动态状态（不稳定内容，仅注入尾段，保证前中段前缀稳定）。
   * 全部字段可选：缺省即「全新运行，无断点、无暂停、无额外运行参数」。
   */
  dynamic: {
    /**
     * 断点继续标记：true 表示本次为恢复运行（已 ok 节点不重跑，从 resumeFromNodeId 继续，
     * 继承链 resumedFromRunId 回填断点产出）。影响末段指导措辞。
     */
    isResume?: boolean
    /**
     * 断点恢复时待继续的起始节点 id（isResume 为 true 时给出）。
     */
    resumeFromNodeId?: string
    /**
     * 继承链来源 run id（恢复运行上一跳记录；空为首次运行）。
     */
    resumedFromRunId?: string
    /**
     * 暂停节点 id 清单：父代理对其中任一调用 wf_run_node（nodeId=暂停节点 id）
     * 即触发暂停门（run=paused + 断点持久化）。缺省为无暂停节点。
     */
    pauseNodeIds?: string[]
    /**
     * 本次运行的额外运行参数说明文本（如模式二 wait 阻塞调度、自定义护栏阈值等）。
     * 缺省为空（模板以占位呈现）。
     */
    runParamsText?: string
  }
}

/**
 * 关键约束的核心短语（首段与末段同时出现，供 W-02 双位测试断言与组装任务引用）。
 * 用英文面向模型（W-03）；保持措辞独立于动态值，避免前缀漂移。
 */
export const ORCH_HARD_CONSTRAINTS = {
  /** 父代理「仅调度不执行」核心短语（首段硬约束 + 末段重申双位出现）。 */
  dispatchOnly: 'orchestrate only — never execute node tasks yourself',
  /** 调用协议：wf_run_node 异步启动（模式一默认）。 */
  runNodeAsync: 'wf_run_node starts a node subagent asynchronously and returns immediately',
  /** 收尾协议：wf_finish 幂等收尾、释放锁。 */
  finishIdempotent: 'finish with wf_finish exactly once — it is idempotent and releases the run lock',
  /** 失败语义：节点失败需显式处置，不静默跳过。 */
  failureSemantics: 'never silently skip a failed node',
  /** 条件连线语义：条件分支由父代理按上游实际产出语义判断。 */
  conditionSemantics: 'you decide conditional branches semantically',
  /** 护栏：失控立即 wf_finish(failed)。 */
  failureImmediate: "call wf_finish({ status: 'failed' }) immediately if you detect loss of control",
} as const

/**
 * 编排指令模板构建器（纯函数）。
 *
 * 输出字符串同一 run 内字节稳定：首段硬约束 + 中段过程性信息固定；
 * 末段重申固定，之后仅追加本次动态状态（facts/dynamic 决定）。不读时钟、不随机。
 *
 * @param params - 模板入参（facts 静态事实 + dynamic 末段动态状态）。
 * @returns 注入父代理的编排指令文本（面向模型，英文）。
 */
export function buildOrchestrationDirective(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params

  // —— 首段：硬约束（最重要约束置于开头，注意力位置 §13.1.2 第一位）——
  const nodeList = facts.nodes.map((n) => `- ${n.id} (${n.label})`).join('\n')
  const collabText =
    facts.collabGroups.length === 0
      ? 'No collaboration groups.'
      : facts.collabGroups
          .map((g) => `- ${g.groupId} (${g.label}): start members [${g.memberIds.join(', ')}] in parallel`)
          .join('\n')

  const head = [
    HEAD_MARKER,
    '',
    `You are the workflow orchestration parent agent for workflow "${facts.workflowName}".`,
    '',
    `1. ${ORCH_HARD_CONSTRAINTS.dispatchOnly}.`,
    `2. Calling protocol: ${ORCH_HARD_CONSTRAINTS.runNodeAsync}.`,
    `   To block until a node finishes (service mode) pass wait: true.`,
    `3. Finish protocol: ${ORCH_HARD_CONSTRAINTS.finishIdempotent}.`,
    `4. Failure semantics: ${ORCH_HARD_CONSTRAINTS.failureSemantics}; retry within the node's limit, ask the user, or fail the run explicitly.`,
    `5. Conditional edges: ${ORCH_HARD_CONSTRAINTS.conditionSemantics}, from the upstream node's actual output.`,
    `6. Guardrails: global call cap 500 wf_run_node calls; idle timeout when no node is in flight.`,
    `7. Loss of control: ${ORCH_HARD_CONSTRAINTS.failureImmediate}.`,
  ].join('\n')

  // —— 中段：过程性信息（节点清单 / 事实源路径 / 协作组并行说明）——
  const mid = [
    MID_MARKER,
    '',
    `Workflow source of truth (read-only file): ${facts.definitionPath} — read it first for the full node list and line semantics.`,
    `Workflow goal: ${facts.workflowGoal.trim() || '(no description)'}`,
    '',
    'Nodes to orchestrate:',
    nodeList,
    '',
    'Collaboration groups (parallel members):',
    collabText,
  ].join('\n')

  // —— 末段：关键约束重申 + 本次动态状态（动态值仅在此注入）——
  const tail = [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- ${ORCH_HARD_CONSTRAINTS.dispatchOnly}.`,
    `- ${ORCH_HARD_CONSTRAINTS.finishIdempotent}.`,
    `- ${ORCH_HARD_CONSTRAINTS.failureSemantics}; ${ORCH_HARD_CONSTRAINTS.failureImmediate} if loss of control.`,
    '',
    renderDynamicState(dynamic),
  ].join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 渲染末段动态状态（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。
 */
function renderDynamicState(dynamic: OrchestrationDirectiveParams['dynamic']): string {
  const lines: string[] = ['Current run state:']
  const pauseIds = dynamic.pauseNodeIds && dynamic.pauseNodeIds.length > 0 ? dynamic.pauseNodeIds : null

  if (dynamic.isResume) {
    lines.push(`- Resuming a prior run (resumedFromRunId: ${dynamic.resumedFromRunId ?? '(unknown)'}).`)
    lines.push(
      `- Already-ok nodes must NOT be re-run; start from node ${dynamic.resumeFromNodeId ?? '(unspecified)'} using the checkpoint outputs for ctx injection.`,
    )
  } else {
    lines.push('- Fresh run; no checkpoint to resume from.')
  }

  if (pauseIds) {
    lines.push(
      `- Pause nodes: [${pauseIds.join(', ')}]. Calling wf_run_node with one of these nodeIds pauses the run and persists a checkpoint; continue later by resuming from its flow-out.`,
    )
  } else {
    lines.push('- No pause nodes in this workflow.')
  }

  lines.push(`- Run parameters: ${(dynamic.runParamsText ?? '').trim() || '(none)'}`)
  return lines.join('\n')
}
