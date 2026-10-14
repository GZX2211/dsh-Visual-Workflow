// src/host/prompts/orchestration.ts
//
// 编排父代理提示词构建器（三情况组装重构后）：
//   - buildOrchestratorPrompt：情况1 纯编排（父代理只调度、不亲自执行）；
//   - buildHybridPrompt：情况2 编排 + 自执行（父代理被流程线连接，先执行自身节点
//     任务，再从本人节点 flow-out 调用 wf_run_node 继续调度）；
//   - 情况3 纯执行（父代理为唯一执行单元、无编排要素）见 executor.ts；
//   - 组合分发（按画布形态判定三情况）见 orchestrator/directive.ts 的
//     parentPromptVariantOf + runtime-launch 的调用点。
//
// 上下文：本指令文本由编排器在 startRun/resumeRun 时一次性 followup 注入「父代理」
//       主会话，指导父代理按 wf_org_catalog 召回的当前实例骨架（instance 通道）自主
//       调度节点子代理、判断条件连线、并在失控或正常走完时 wf_finish 收尾。
//       拓扑不进本指令：只给召回入口，不给宿主路径（父代理无从进入用户私有存储）。
//
// 稳定布局（前缀稳定 + 关键约束双位 + 动态值仅注入末尾）：
//   ① 首段 = 硬约束（身份/调度协议/完成判定信号/收尾/失败语义/条件连线/组内通信）
//   ② 中段 = 过程性信息（拓扑召回入口 / 工作流目标 / 协作组并行说明，协作组按需输出）
//   ③ 末段 = 关键约束重申 + 本次动态状态（断点继续 / 暂停 / 运行参数 / 情况2的
//            父代理自执行单元任务块等动态值仅在此注入）
//
// 构建器均为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同。

import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js'
import { languageRuleLine } from './prompt-rules.js'
import type { CollabChannel } from './collab.js'

/** 父代理提示词变体（三情况组装分发）：orchestrator=纯编排 / hybrid=编排+自执行 / executor=纯执行。 */
export type ParentPromptVariant = 'orchestrator' | 'hybrid' | 'executor'

/**
 * 编排系模板（情况1/2）的入参（中文注释每个字段）。
 * `facts` 是同一 run 内字节稳定的静态事实；`dynamic` 是仅注入末段的动态状态。
 */
export interface OrchestrationDirectiveParams {
  facts: {
    /** 工作流名称（人类可读标题，注入节点清单标题）。 */
    workflowName: string
    /** 工作流目标描述；可为空字符串。 */
    workflowGoal: string
    /** 节点清单：流程中参与流程的可调度 agent 节点（id + 人类可读名称）。 */
    nodes: Array<{ id: string; label: string }>
    /** 协作组卡片与成员清单（画布含 协作组卡片时组装该段；空数组 = 不组装该段）。 */
    collabGroups: Array<{ groupId: string; label: string; memberIds: string[] }>
    /**
     * 协作通道（协作组段文案的分支依据）：
     *   - official = 官方 Agent 协作组可用 → 成员以官方 teammate 身份启动，协作与任务板走官方工具；
     *   - legacy = 官方团队不可用 → 成员降级为普通子代理，组内通信用 wf_ask_agent。
     * 缺省 legacy。
     */
    collabChannel?: CollabChannel
    /** 情况2（hybrid）：父代理自身执行单元身份（被流程线连接）；情况1 缺省 null。 */
    parentNode?: { nodeId: string; nodeLabel: string } | null
    /** 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。注入语言规则。 */
    systemLanguage: string
  }
  /**
   * 末段动态状态（不稳定内容，仅注入尾段，保证前中段前缀稳定）。
   * 全部字段可选：缺省即「全新运行，无断点、无暂停、无额外运行参数」。
   */
  dynamic: {
    /** 断点继续标记：true 表示本次为恢复运行（已 ok 节点不重跑，从 resumeFromNodeId 继续）。 */
    isResume?: boolean
    /** 断点恢复时待继续的起始节点 id（isResume 为 true 时给出）。 */
    resumeFromNodeId?: string
    /** 继承链来源 run id（恢复运行上一跳记录；空为首次运行）。 */
    resumedFromRunId?: string
    /** 暂停节点 id 清单：父代理对其中任一调用 wf_run_node（nodeId=暂停节点 id）即触发暂停门。 */
    pauseNodeIds?: string[]
    /** 本次运行的额外运行参数说明文本（如模式二 wait 阻塞调度）。 */
    runParamsText?: string
    /** 模式二本次外部请求的用户问题（不稳定内容，仅末段注入；模式一无）。 */
    question?: string
    /**
     * 「本次组织预算」末段文本（自主编排方案 §6.4；buildOrgBudgetText 输出）。
     * 取值口径 = 快照冻结元参数（D-13 第三层）+ 当前图规模 → **剩余量**；
     * 属动态值，只在末段注入（P2 正式接入，见 runtime-launch 的 startRun/resumeRun）。
     */
    orgBudgetText?: string
    /** 情况2：父代理自执行单元任务块（buildParentTaskSpec 输出；本 run 内字节稳定）。 */
    parentTaskBlock?: string
  }
}

/**
 * 编排系关键约束短语（首段与末段同时出现，供 W-02 双位测试断言与组装任务引用）。
 * 用中文面向模型（W-04）；工具名与工具 schema 描述保留英文（W-03）；措辞独立于动态值，避免前缀漂移。
 */
export const ORCH_HARD_CONSTRAINTS = {
  /** 父代理「仅调度不执行」核心短语（情况1 首段 + 末段重申双位）。 */
  dispatchOnly: '仅编排：你只负责调度子代理，不亲自执行节点任务',
  /**
   * 节点完成判定（双重汇报防治，一句话）：子代理主动 report ≠ 完成；
   * 只有 DSH 自动送达的结算通知才是节点完成的权威信号。
   */
  nodeSettledSignal:
    '节点判定：只有收到结算通知（Background subagent … finished …）才算该节点完成',
  /** 收尾协议：wf_finish 幂等收尾、释放锁。 */
  finishIdempotent: '收尾时调用 wf_finish （只调用一次，幂等，释放运行锁）',
  /** 失败语义：节点失败需显式处置，不静默跳过。 */
  failureSemantics: '绝不静默跳过失败节点',
  /** 条件连线语义：条件分支由父代理按上游实际产出语义判断。 */
  conditionSemantics: '条件分支由你依据上游节点的实际产出进行语义判断',
  /** 情况2 执行者模式核心短语：你本人也是执行节点，先执行自身任务再调度。 */
  executorRole: '执行+编排：你既是执行节点，也要负责调度子代理；你只执行指向自身的节点任务',
} as const

/**
 * 情况1（纯编排）父代理提示词构建器（纯函数）。
 * 首段仅编排身份 + 完成判定信号 + 调度协议；不包含执行者模式条目。
 */
export function buildOrchestratorPrompt(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params
  const langRule = languageRuleLine(facts.systemLanguage)

  const head = buildHeadSection(
    `你是工作流「${facts.workflowName}」的编排父代理。`,
    ORCH_HARD_CONSTRAINTS.dispatchOnly,
    langRule,
  )

  const mid = buildMidSection(facts)

  const tail = buildTailSection(langRule, dynamic)

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。
 * 首段以执行者模式取代「仅编排」；末段重申含收尾与失败语义，
 * dynamic.parentTaskBlock 为父代理自执行单元任务块（buildParentTaskSpec 输出）。
 */
export function buildHybridPrompt(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params
  const parent = facts.parentNode
  const langRule = languageRuleLine(facts.systemLanguage)

  const head = buildHeadSection(
    `你是工作流「${facts.workflowName}」的编排父代理${parent ? `，同时以节点「${parent.nodeLabel}」（id=${parent.nodeId}）的身份执行自身任务` : ''}。`,
    ORCH_HARD_CONSTRAINTS.executorRole,
    langRule,
  )

  const mid = buildMidSection(facts)

  const tail = buildTailSection(langRule, dynamic)

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 编排系首段硬约束（情况1/2 共用；两个变体只差身份行与第 1 条身份约束）。
 * 共用组装保证「完成判定信号 / 收尾 / 失败语义 / 条件连线」的条目与顺序
 * 在两种画布形态下始终一致（W-02 双位的第一位）。
 */
function buildHeadSection(identityLine: string, roleConstraint: string, langRule: string): string {
  const c = ORCH_HARD_CONSTRAINTS
  return [
    HEAD_MARKER,
    '',
    identityLine,
    '',
    `1. ${roleConstraint}。`,
    `2. ${c.nodeSettledSignal}；收到前不得推进下游或收尾。`,
    `3. ${c.finishIdempotent}。`,
    `4. ${c.failureSemantics}；可重试一次，若仍失败则询问用户；若编排失控或确认无法继续，即终止运行。`,
    `5. ${c.conditionSemantics}。`,
    ...(langRule ? [`6. ${langRule}`] : []),
  ].join('\n')
}

/**
 * 编排系末段（情况1/2 共用）：关键约束重申（W-02 双位的第二位）+ 本次动态状态。
 * 动态值只在末段注入，保证前中段在同一 run 内字节稳定。
 */
function buildTailSection(langRule: string, dynamic: OrchestrationDirectiveParams['dynamic']): string {
  return [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- ${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `- ${ORCH_HARD_CONSTRAINTS.failureSemantics}。`,
    ...(langRule ? [`- ${langRule}`] : []),
    '',
    renderDynamicState(dynamic),
  ].join('\n')
}

/** 中段过程性信息（情况1/2 共用）：拓扑召回入口 + 目标 + Team（按需）。 */
function buildMidSection(facts: OrchestrationDirectiveParams['facts']): string {
  const midParts: string[] = [
    MID_MARKER,
    '',
    // 拓扑不再经文件读取，只经 wf_org_catalog 的 instance 通道召回（用户裁决 2026.10）：
    // 既不给宿主路径（父代理无从进入用户私有存储），也避免整份流程 JSON 超出单次读取
    // 窗口导致「读到截断的前半部而不自知」。增量口径不变：父代理上一轮的召回结果仍在
    // 上下文中，只在「还没召回」「刚改过图」「收到【编排变更】通知」三种情况下才需要再召回。
    '工作流拓扑：用 wf_org_catalog（ids: ["instance"]）召回当前运行实例的骨架'
    + '（节点、连线与可调度标记）；不要试图从文件系统读取编排定义。'
    + '首次调度前必须召回一次；此后仅在收到【编排变更】通知或你自己用 wf_graph_patch 改过图之后再召回，无需每轮重召回。',
  ]
  const goal = String(facts.workflowGoal ?? '').trim()
  if (goal) midParts.push('', `工作流目标：${goal}`)
  // 协作组段仅在画布存在 协作组卡片时组装。
  if (facts.collabGroups.length > 0) {
    const official = facts.collabChannel === 'official'
    const collabText = facts.collabGroups
      .map((g) => `- ${g.groupId}（${g.label}）：成员节点 [${g.memberIds.join(', ')}]`)
      .join('\n')
    midParts.push('', official ? 'Team（官方团队）：' : 'Team（降级通道）：', collabText)
    if (official) {
      midParts.push(
        '',
        '协作组卡片是包裹层、不是执行单元：逐个调用 wf_run_node(成员节点 id) 启动成员；直接对 协作组卡片调用会被拒绝。',
        '成员以官方 teammate 身份运行，自带官方 协作组工具（list_agents / send_message / team_task_*）与官方协作策略；'
        + '分工与交接用官方任务板登记（team_task_create → claim → complete，按 revision 做 CAS 更新），不要自建任务清单。',
        '成员由画布定义、由插件创建：不要自行调用 spawn_teammate 创建成员，也不要给成员改名。',
      )
    } else {
      midParts.push(
        '',
        '官方 协作组不可用：成员降级为普通子代理，逐个用 wf_run_node 启动；组内通信用 wf_ask_agent。',
      )
    }
  }
  return midParts.join('\n')
}

/** 渲染末段动态状态（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。 */
function renderDynamicState(dynamic: OrchestrationDirectiveParams['dynamic']): string {
  const lines: string[] = ['当前运行状态：']
  const pauseIds = dynamic.pauseNodeIds && dynamic.pauseNodeIds.length > 0 ? dynamic.pauseNodeIds : null

  if (dynamic.isResume) {
    lines.push(`- 正在恢复先前运行（resumedFromRunId：${dynamic.resumedFromRunId ?? '（未知）'}）。`)
    lines.push(
      `- 已 ok 的节点不得重跑；从节点 ${dynamic.resumeFromNodeId ?? '（未指定）'} 开始，使用检查点产出注入 ctx。`,
    )
  } else {
    lines.push('- 全新运行；无可恢复的检查点。')
  }

  if (pauseIds) {
    lines.push(
      `- 暂停节点：[${pauseIds.join(', ')}]。暂停运行并持久化检查点；之后从其 flow-out 恢复继续。`,
    )
  } else {
    lines.push('- 本工作流无暂停节点。')
  }

  lines.push(`- 运行参数：${(dynamic.runParamsText ?? '').trim() || '（无）'}`)
  if (dynamic.question) {
    lines.push(`- 用户问题（服务模式）：${dynamic.question}`)
  }
  // 组织预算（P2）：给剩余量口径，父代理据此判断还能扩张多少（禁改图预算属硬护栏）
  if (dynamic.orgBudgetText) {
    lines.push('')
    lines.push(dynamic.orgBudgetText)
  }
  // 情况2：父代理自执行单元任务块注入末段（动态值仅末段；本 run 内字节稳定）
  if (dynamic.parentTaskBlock) {
    lines.push('')
    lines.push('【你的节点任务】（以下任务由你亲自执行，不得下发）：')
    lines.push(dynamic.parentTaskBlock)
  }
  return lines.join('\n')
}