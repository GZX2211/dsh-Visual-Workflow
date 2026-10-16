// src/host/prompts/parents.ts
//
// 父代理提示词构建器（情况1 纯编排 / 情况2 编排+自执行 / 情况3 纯执行 + 情况2 末段任务块）。
//
// 组装方式：正文全部在 texts/parent-*.ts；本文件只把事实翻译成模板变量并渲染一次。
// 模板变量命名与 texts/ 文件头的「变量」注释一一对应。

import { flag, renderTemplate, type TemplateVars } from './render.js'
import { PARENT_ORCHESTRATOR } from './texts/parent-orchestrator.js'
import { PARENT_HYBRID } from './texts/parent-hybrid.js'
import { PARENT_EXECUTOR, PARENT_TASK_SPEC } from './texts/parent-executor.js'
import type { CollabChannel } from './child.js'

/** 父代理提示词变体（三情况组装分发）：orchestrator=纯编排 / hybrid=编排+自执行 / executor=纯执行。 */
export type ParentPromptVariant = 'orchestrator' | 'hybrid' | 'executor'

/**
 * 编排系模板（情况1/2）的入参。
 * `facts` 是同一 run 内字节稳定的静态事实；`dynamic` 是运行期动态状态。
 */
export interface OrchestrationDirectiveParams {
  facts: {
    /** 工作流名称（人类可读标题）。 */
    workflowName: string
    /** 工作流目标描述；可为空字符串。 */
    workflowGoal: string
    /** Team 卡片与成员清单（画布含 Team 卡片时组装该段；空数组 = 不组装该段）。 */
    collabGroups: Array<{ groupId: string; label: string; memberIds: string[] }>
    /** 协作通道：official = 官方 Agent Team 可用；legacy = 成员降级为普通子代理。缺省 legacy。 */
    collabChannel?: CollabChannel
    /** 情况2（hybrid）：父代理自身执行单元身份；情况1 缺省 null。 */
    parentNode?: { nodeId: string; nodeLabel: string } | null
    /** 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。 */
    systemLanguage: string
  }
  /** 运行期动态状态（缺省即「全新运行，无断点、无暂停、无额外运行参数」）。 */
  dynamic: {
    /** 断点继续标记：true 表示本次为恢复运行。 */
    isResume?: boolean
    /** 断点恢复时待继续的起始节点 id。 */
    resumeFromNodeId?: string
    /** 继承链来源 run id。 */
    resumedFromRunId?: string
    /** 暂停节点 id 清单。 */
    pauseNodeIds?: string[]
    /** 本次运行的额外运行参数说明文本。 */
    runParamsText?: string
    /** 模式二本次外部请求的用户问题。 */
    question?: string
    /** 情况2：父代理自执行单元任务块（buildParentTaskSpec 输出）。 */
    parentTaskBlock?: string
  }
}

/** 执行单元共用的过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）。 */
export interface ExecutorContextFacts {
  /** 节点人类可读名称。 */
  nodeLabel: string
  /** 上游产出上下文（全链路自动注入；数组元素为「来源名称 + 来源节点 id + 内容」，可为空）。 */
  upstreamContext: Array<{ nodeId: string; source: string; content: string }>
  /** 文件路径索引（data/files/ 受管路径），可为空。 */
  filePaths: string[]
  /** 数据库工具说明（db-in 连线存在时非空），可为空。 */
  dbToolHint: string
  /** Team 成员标记：注入组内通信必须经 wf_ask_agent 的软约束。 */
  isGroupMember: boolean
}

/** 情况2 父代理自执行单元任务块入参。 */
export interface ParentTaskSpecParams {
  facts: ExecutorContextFacts
  /** 本次执行单元的运行上下文说明（runId、attempt 等；可为空）。 */
  runContextText?: string
  /** 系统语言名（如 '中文' / 'English'）。 */
  systemLanguage: string
}

/** 情况3 纯执行父代理提示词入参。 */
export interface ParentExecutorPromptParams {
  /** 工作流名称。 */
  workflowName: string
  facts: ExecutorContextFacts
  /** 本次执行的运行上下文说明（runId、attempt 等）。 */
  runContextText: string
  /** 系统语言名（如 '中文' / 'English'）。 */
  systemLanguage: string
}

/** 上游产出行（多行文本；无上游时返回空串，由模板输出「（无）」）。 */
function upstreamLinesOf(entries: Array<{ nodeId: string; source: string; content: string }>): string {
  return entries.map((entry) => `- ${entry.source}（id：${entry.nodeId}）：${entry.content}`).join('\n')
}

/** 文件路径索引行（多行文本）。 */
function fileLinesOf(filePaths: string[]): string {
  return filePaths.map((filePath) => `- ${filePath}`).join('\n')
}

/** 执行单元上下文变量（情况2 任务块与情况3 提示词共用同一口径）。 */
function executorContextVars(facts: ExecutorContextFacts): TemplateVars {
  return {
    nodeLabel: facts.nodeLabel,
    upstreamEntries: upstreamLinesOf(facts.upstreamContext),
    noUpstream: flag(facts.upstreamContext.length === 0),
    filePathsText: fileLinesOf(facts.filePaths),
    dbToolHint: String(facts.dbToolHint ?? '').trim(),
  }
}

/** Team 段变量（无 Team 卡片时不出现该段）。 */
function teamVarsOf(facts: OrchestrationDirectiveParams['facts']): TemplateVars {
  const groups = facts.collabGroups ?? []
  const official = facts.collabChannel === 'official'
  return {
    teamGroups: groups
      .map((group) => `- ${group.groupId}（${group.label}）：成员节点 [${group.memberIds.join(', ')}]`)
      .join('\n'),
    teamChannelLabel: official ? '官方团队' : '降级通道',
    teamOfficial: flag(official),
    teamLegacy: flag(!official),
  }
}

/** 运行期任务输入变量（情况1/2 共用）：用户问题与父代理自执行任务块。 */
function dynamicVarsOf(dynamic: OrchestrationDirectiveParams['dynamic']): TemplateVars {
  return {
    question: String(dynamic.question ?? '').trim(),
    parentTaskBlock: String(dynamic.parentTaskBlock ?? '').trim(),
  }
}

/** 情况1（纯编排）父代理提示词构建器（纯函数）。 */
export function buildOrchestratorPrompt(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params
  return renderTemplate(PARENT_ORCHESTRATOR, {
    workflowName: facts.workflowName,
    systemLanguage: String(facts.systemLanguage ?? '').trim(),
    workflowGoal: String(facts.workflowGoal ?? '').trim(),
    ...teamVarsOf(facts),
    ...dynamicVarsOf(dynamic),
  })
}

/** 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。 */
export function buildHybridPrompt(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params
  const parent = facts.parentNode
  return renderTemplate(PARENT_HYBRID, {
    workflowName: facts.workflowName,
    parentNodeLabel: parent ? parent.nodeLabel : '',
    parentNodeId: parent ? parent.nodeId : '',
    systemLanguage: String(facts.systemLanguage ?? '').trim(),
    workflowGoal: String(facts.workflowGoal ?? '').trim(),
    ...teamVarsOf(facts),
    ...dynamicVarsOf(dynamic),
  })
}

/**
 * 情况2 父代理自执行单元任务块（编排指令末段小节正文；纯函数）。
 * 只列过程性信息与运行上下文，不含块级标题（避免与编排指令嵌套冲突）。
 */
export function buildParentTaskSpec(params: ParentTaskSpecParams): string {
  const { facts, runContextText } = params
  return renderTemplate(PARENT_TASK_SPEC, {
    ...executorContextVars(facts),
    runContextText: String(runContextText ?? '').trim(),
  })
}

/** 情况3 纯执行父代理提示词构建器（纯函数）。 */
export function buildParentExecutorPrompt(params: ParentExecutorPromptParams): string {
  const { workflowName, facts, runContextText, systemLanguage } = params
  return renderTemplate(PARENT_EXECUTOR, {
    workflowName,
    systemLanguage: String(systemLanguage ?? '').trim(),
    isGroupMember: flag(facts.isGroupMember),
    runContextText: String(runContextText ?? '').trim() || '（无）',
    ...executorContextVars(facts),
  })
}
