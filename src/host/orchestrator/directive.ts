// src/host/orchestrator/directive.ts
//
// 父代理提示词变体判定与编排指令组装（纯函数）：
//   - parentPromptVariantOf / parentExecutorOf：按画布形态判定三情况（orchestrator / hybrid / executor）；
//   - directiveParams：facts 静态事实 + dynamic 末段动态态（前缀稳定）；
//   - buildParentRunPrompt：startRun/resumeRun 共用的整份提示词组装。
// 入参（flow/defPath/mode/executor/动态）不变则输出字节不变。

import type { OrchestrationDirectiveParams, ParentPromptVariant } from '../prompts/orchestration.js'
import { buildHybridPrompt, buildOrchestratorPrompt } from '../prompts/orchestration.js'
import { buildParentExecutorPrompt, buildParentTaskSpec, type ExecutorContextFacts } from '../prompts/executor.js'
import { nodeHasFlowIn, nodeParticipatesInFlow } from '../graph/model.js'
import type { WorkflowDocument } from '../shared/graph-model.js'
import { collabGroupList, labelOf, orchestrationNodeList, pauseNodeIdsOf } from './graph-facts.js'

/**
 * 父代理提示词变体判定（三情况，纯函数）：
 *   - orchestrator：纯编排——无父代理节点，或父代理（含其虚拟节点）未被流程线驱动
 *     （无 flow-in 入边）；
 *   - hybrid：编排 + 自执行——父代理被流程线驱动，且画布中**还存在其他参与流程的
 *     可执行单元**（agent 角色或其虚拟节点、协作组卡片任一参与流程线）；
 *   - executor：纯执行——父代理是唯一参与流程的可执行单元；画布上允许存在未参与
 *     流程的无关 agent/协作组节点（不执行任务，不进入编排清单）。
 */
export function parentPromptVariantOf(flow: WorkflowDocument): ParentPromptVariant {
  const parent = flow.nodes.find((n) => n.kind === 'parent')
  // 父代理「被流程线连接」= 存在 flow-in 驱动（主节点或虚拟节点）；仅 flow-out 不构成激活
  if (!parent || !nodeHasFlowIn(flow, parent.id)) return 'orchestrator'
  const othersActive = flow.nodes.some((n) => {
    if (n.id === parent.id) return false
    if (n.kind === 'agent') return nodeParticipatesInFlow(flow, n.id)
    if (n.kind === 'group') return nodeParticipatesInFlow(flow, n.id)
    return false
  })
  return othersActive ? 'hybrid' : 'executor'
}

/**
 * 父代理是否为执行者模式：父代理（或其虚拟节点）被流程线连接，作为执行单元
 * 先执行自身任务再视情况继续调度。判定结果与 parentPromptVariantOf 一致：
 * 返回 null = 纯编排（orchestrator），否则返回父代理节点身份。
 */
export function parentExecutorOf(flow: WorkflowDocument): { nodeId: string; nodeLabel: string } | null {
  const variant = parentPromptVariantOf(flow)
  if (variant === 'orchestrator') return null
  const parent = flow.nodes.find((n) => n.kind === 'parent')
  if (!parent) return null
  return { nodeId: parent.id, nodeLabel: labelOf(parent) }
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
    /** 情况2（hybrid）：父代理执行单元身份（父代理被流程线连接；静态）。 */
    parentNode?: { nodeId: string; nodeLabel: string }
    /** 情况2：父代理自执行单元任务块（buildParentTaskSpec 输出；动态值仅末段）。 */
    parentTaskBlock?: string
    /** 系统语言名（从 DSH 用户设置读取；注入语言规则）。 */
    systemLanguage?: string
    /** 「本次组织预算」末段文本（冻结快照 → 剩余量口径；P2 注入）。 */
    orgBudgetText?: string
  },
): OrchestrationDirectiveParams {
  return {
    facts: {
      workflowName: flow.name ?? flow.id,
      workflowGoal: flow.description ?? '',
      definitionPath: defPath,
      nodes: orchestrationNodeList(flow),
      collabGroups: collabGroupList(flow),
      parentNode: extra?.parentNode ?? null,
      systemLanguage: extra?.systemLanguage ?? '',
    },
    dynamic: {
      pauseNodeIds: pauseNodeIdsOf(flow),
      runParamsText:
        mode === 'mode2'
          ? 'mode2 (service): use wf_run_node_wait to start each node and block until it finishes; never use wf_run_node.'
          : 'mode1 (orchestration): use wf_run_node to start each node asynchronously; never use wf_run_node_wait.',
      ...(extra?.question ? { question: extra.question } : {}),
      ...(extra?.orgBudgetText ? { orgBudgetText: extra.orgBudgetText } : {}),
      ...(extra?.parentTaskBlock ? { parentTaskBlock: extra.parentTaskBlock } : {}),
      ...(extra?.resume
        ? { isResume: true, resumeFromNodeId: extra.resume.resumeFromNodeId, resumedFromRunId: extra.resume.resumedFromRunId }
        : {}),
    },
  }
}

/**
 * 父代理运行提示词统一组装（startRun/resumeRun 共用；三情况整体替换组装）：
 *   - orchestrator（情况1）：buildOrchestratorPrompt，纯编排；
 *   - hybrid（情况2）：buildHybridPrompt，编排指令 + 末段【你的节点任务】执行单元任务块；
 *   - executor（情况3）：buildParentExecutorPrompt，纯执行提示（无任何编排要素）；
 *   - 续跑继承边界：hybrid/executor 但父代理执行单元已 ok（断点继承完成、无任务块）
 *     时按 orchestrator 变体组装（剩余运行只有编排/收尾，不再含自执行任务内容），
 *     避免提示词出现「先执行自身节点任务」但无任务可执行的自相矛盾。
 * 纯函数：入参（flow/defPath/mode/executor/动态）不变则输出字节不变。
 */
export function buildParentRunPrompt(input: {
  flow: WorkflowDocument
  defPath: string
  mode: 'mode1' | 'mode2'
  /** 模式二用户问题（不稳定内容，仅末段）。 */
  question?: string
  /** 断点继续事实（resumeRun 用）。 */
  resume?: { resumeFromNodeId?: string; resumedFromRunId: string }
  /** 父代理执行单元（具体情况2/3）；纯编排或续跑继承完成时为 null。 */
  executor: { nodeId: string; nodeLabel: string; task: ExecutorContextFacts; runContextText: string } | null
  /** 系统语言名（从 DSH 用户设置读取；注入语言规则）。 */
  systemLanguage: string
  /** 「本次组织预算」末段文本（冻结快照 → 剩余量口径；P2 起由 startRun/resumeRun 注入）。 */
  orgBudgetText?: string
}): string {
  const { flow, defPath, mode, executor, systemLanguage } = input
  const variant = parentPromptVariantOf(flow)
  const resume = input.resume

  // 情况3：纯执行（父代理为唯一参与流程的执行单元，且有执行单元内容）
  if (variant === 'executor' && executor) {
    return buildParentExecutorPrompt({
      workflowName: flow.name ?? flow.id,
      facts: executor.task,
      runContextText: executor.runContextText,
      systemLanguage,
    })
  }

  // 情况2：编排 + 自执行（有执行单元内容）
  if (variant === 'hybrid' && executor) {
    return buildHybridPrompt(
      directiveParams(flow, defPath, mode, {
        ...(resume ? { resume } : {}),
        ...(input.question ? { question: input.question } : {}),
        ...(input.orgBudgetText ? { orgBudgetText: input.orgBudgetText } : {}),
        parentNode: { nodeId: executor.nodeId, nodeLabel: executor.nodeLabel },
        parentTaskBlock: buildParentTaskSpec({ facts: executor.task, runContextText: executor.runContextText, systemLanguage }),
        systemLanguage,
      }),
    )
  }

  // 情况1：纯编排；或 hybrid/executor 在续跑中父代理执行单元已 ok（继承完成 → 纯编排语义）
  return buildOrchestratorPrompt(
    directiveParams(flow, defPath, mode, {
      ...(resume ? { resume } : {}),
      ...(input.question ? { question: input.question } : {}),
      ...(input.orgBudgetText ? { orgBudgetText: input.orgBudgetText } : {}),
      systemLanguage,
    }),
  )
}
