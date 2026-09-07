// src/host/prompts/orchestration.ts
//
// 编排父代理提示词构建器（三情况组装重构后）：
//   - buildOrchestratorPrompt：情况1 纯编排（父代理只调度、不亲自执行）；
//   - buildHybridPrompt：情况2 编排 + 自执行（父代理被流程线连接，先执行自身节点
//     任务，再从本人节点 flow-out 调用 wf_run_node 继续调度）；
//   - 情况3 纯执行（父代理为唯一执行单元、无编排要素）见 executor.ts；
//   - 组合分发（按画布形态判定三情况）见 orchestrator/helpers.ts 的
//     parentPromptVariantOf + runtime-launch 的调用点。
//
// 上下文：本指令文本由编排器在 startRun/resumeRun 时一次性 followup 注入「父代理」
//       主会话，指导父代理按 流程事实源（orchestrations/<runId>.json）自主调度节点
//       子代理、判断条件连线、并在失控或正常走完时 wf_finish 收尾。
//
// 稳定布局（前缀稳定 + 关键约束双位 + 动态值仅注入末尾）：
//   ① 首段 = 硬约束（身份/调度协议/完成判定信号/收尾/失败语义/条件连线/失控/组内通信）
//   ② 中段 = 过程性信息（事实源路径 / 节点清单 / 协作组并行说明，协作组按需输出）
//   ③ 末段 = 关键约束重申 + 本次动态状态（断点继续 / 暂停 / 运行参数 / 情况2的
//            父代理自执行单元任务块等动态值仅在此注入）
//
// 提示词准确性改造要点（用户评审落定）：
//   - 情况1 删「执行者模式」条目；情况2 以「执行者模式」取代「仅编排」——两种身份
//     互斥，整份替换组装，杜绝嵌套冲突；
//   - 删除引擎级护栏条目（wf_run_node 全局调用上限、空闲超时）：AI 无选择权，写入无用；
//   - 新增「节点完成判定」一句话（双重汇报防治）：report ≠ 完成，以 DSH 自动送达的
//     结算通知为准，收到前不得推进下游或收尾运行；
//   - 协作组段仅在画布存在协作组时组装；待编排节点只列「参与流程」的 agent 节点
//     （未参与流程的无关节点不进入清单）；
//   - 事实源警示句精简；动态值（断点/暂停/运行参数/父代理自执行单元任务）仅注入末段。
//
// 构建器均为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同。

import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js'

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
    /** 流程事实源文件路径（父代理需 read 的只读 JSON 路径）。 */
    definitionPath: string
    /** 节点清单：流程中参与流程的可调度 agent 节点（id + 人类可读名称）。 */
    nodes: Array<{ id: string; label: string }>
    /** 协作组成员并行说明（画布含协作组时组装该段；空数组 = 不组装协作组段）。 */
    collabGroups: Array<{ groupId: string; label: string; memberIds: string[] }>
    /** 情况2（hybrid）：父代理自身执行单元身份（被流程线连接）；情况1 缺省 null。 */
    parentNode?: { nodeId: string; nodeLabel: string } | null
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
    '节点完成判定：只有收到结算通知（Background subagent … finished …）才算该节点完成',
  /** 调用协议：模式一 wf_run_node 异步启动。 */
  runNodeAsync: '模式一用 wf_run_node：异步启动节点子代理并立即返回',
  /** 调用协议：模式二 wf_run_node_wait 阻塞等待。 */
  runNodeBlocking: '模式二用 wf_run_node_wait：阻塞启动节点子代理直至节点完成',
  /** 收尾协议：wf_finish 幂等收尾、释放锁。 */
  finishIdempotent: '以 wf_finish 收尾（只调用一次，幂等，并释放运行锁）',
  /** 失败语义：节点失败需显式处置，不静默跳过。 */
  failureSemantics: '绝不静默跳过失败节点',
  /** 条件连线语义：条件分支由父代理按上游实际产出语义判断。 */
  conditionSemantics: '条件分支由你依据上游节点的实际产出进行语义判断',
  /** 失控处理：失控立即 wf_finish(failed)。 */
  failureImmediate: "检测到失控时立即调用 wf_finish({ status: 'failed' })",
  /** 协作通信超时处置：征询用户后 resolve 三动作。 */
  askAgentTimeout:
    '收到 wf_ask_agent 的 ask 超时通知时，先用 ask_user_question 征询用户，再用 wf_ask_agent resolve（continue / resend / abort）定案',
  /** 情况2 执行者模式核心短语：你本人也是执行节点，先执行自身任务再调度。 */
  executorRole: '执行者模式：你本人也是执行节点，启动后必须先执行自身节点任务，完成后从本人节点的 flow-out 调用 wf_run_node 继续调度',
} as const

/**
 * 情况1（纯编排）父代理提示词构建器（纯函数）。
 * 首段仅编排身份 + 完成判定信号 + 调度协议；不包含执行者模式条目。
 */
export function buildOrchestratorPrompt(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params
  const nodeList = facts.nodes.map((n) => `- ${n.id} (${n.label})`).join('\n')

  const head = [
    HEAD_MARKER,
    '',
    `你是工作流「${facts.workflowName}」的编排父代理。`,
    '',
    `1. ${ORCH_HARD_CONSTRAINTS.dispatchOnly}。`,
    `2. ${ORCH_HARD_CONSTRAINTS.nodeSettledSignal}；收到前不得判定节点完成、推进下游或收尾运行。`,
    `3. 调用协议：${ORCH_HARD_CONSTRAINTS.runNodeAsync}；${ORCH_HARD_CONSTRAINTS.runNodeBlocking}。`,
    `4. 收尾协议：${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `5. 失败语义：${ORCH_HARD_CONSTRAINTS.failureSemantics}；在节点限额内重试、询问用户，或显式终止本次运行。`,
    `6. 条件连线：${ORCH_HARD_CONSTRAINTS.conditionSemantics}。`,
    `7. 失控处理：${ORCH_HARD_CONSTRAINTS.failureImmediate}。`,
    `8. 组内通信：${ORCH_HARD_CONSTRAINTS.askAgentTimeout}。`,
    `9. 每次调度前必须重新读取事实源，以文件最新内容为准。`,
  ].join('\n')

  const mid = buildMidSection(facts)

  const tail = [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- ${ORCH_HARD_CONSTRAINTS.dispatchOnly}。`,
    `- ${ORCH_HARD_CONSTRAINTS.nodeSettledSignal}。`,
    `- ${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `- ${ORCH_HARD_CONSTRAINTS.failureSemantics}；${ORCH_HARD_CONSTRAINTS.failureImmediate}（失控时）。`,
    '',
    renderDynamicState(dynamic),
  ].join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。
 * 首段以执行者模式取代「仅编排」；末段重申含执行者模式与完成判定信号，
 * dynamic.parentTaskBlock 为父代理自执行单元任务块（buildParentTaskSpec 输出）。
 */
export function buildHybridPrompt(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params
  const parent = facts.parentNode
  const nodeList = facts.nodes.map((n) => `- ${n.id} (${n.label})`).join('\n')

  const head = [
    HEAD_MARKER,
    '',
    `你是工作流「${facts.workflowName}」的编排父代理${parent ? `，同时以执行节点「${parent.nodeLabel}」（id=${parent.nodeId}）的身份先执行自身任务` : ''}。`,
    '',
    `1. ${ORCH_HARD_CONSTRAINTS.executorRole}。`,
    `2. ${ORCH_HARD_CONSTRAINTS.nodeSettledSignal}；收到前不得判定节点完成、推进下游或收尾运行。`,
    `3. 调用协议：${ORCH_HARD_CONSTRAINTS.runNodeAsync}；${ORCH_HARD_CONSTRAINTS.runNodeBlocking}。`,
    `4. 收尾协议：${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `5. 失败语义：${ORCH_HARD_CONSTRAINTS.failureSemantics}；在节点限额内重试、询问用户，或显式终止本次运行。`,
    `6. 条件连线：${ORCH_HARD_CONSTRAINTS.conditionSemantics}。`,
    `7. 失控处理：${ORCH_HARD_CONSTRAINTS.failureImmediate}。`,
    `8. 组内通信：${ORCH_HARD_CONSTRAINTS.askAgentTimeout}。`,
    `9. 每次调度前必须重新读取事实源，以文件最新内容为准。`,
  ].join('\n')

  const mid = buildMidSection(facts)

  const tail = [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- 每次调度前必须重新读取事实源，以文件最新内容为准。`,
    `- ${ORCH_HARD_CONSTRAINTS.nodeSettledSignal}。`,
    `- ${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `- ${ORCH_HARD_CONSTRAINTS.failureSemantics}；${ORCH_HARD_CONSTRAINTS.failureImmediate}（失控时）。`,
    '',
    renderDynamicState(dynamic),
  ].join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/** 中段过程性信息（情况1/2 共用）：事实源 + 目标 + 待编排节点 + 协作组（按需）。 */
function buildMidSection(facts: OrchestrationDirectiveParams['facts']): string {
  const nodeList = facts.nodes.map((n) => `- ${n.id} (${n.label})`).join('\n')
  const midParts: string[] = [
    MID_MARKER,
    '',
    `工作流事实源（只读文件）：${facts.definitionPath} —— 请先读取它，以获取完整节点列表与连线语义。`,
  ]
  const goal = String(facts.workflowGoal ?? '').trim()
  if (goal) midParts.push('', `工作流目标：${goal}`)
  if (nodeList) midParts.push('', '待编排节点（启动时快照，不作为调度依据）：', nodeList)
  // 协作组段仅在画布存在协作组时组装（用户批注：无协作组节点时此项不组装）。
  if (facts.collabGroups.length > 0) {
    const collabText = facts.collabGroups
      .map((g) => `- ${g.groupId}（${g.label}）：并行启动成员 [${g.memberIds.join(', ')}]`)
      .join('\n')
    midParts.push('', '协作组（并行成员）：', collabText)
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
      `- 暂停节点：[${pauseIds.join(', ')}]。以其中任一 nodeId 调用 wf_run_node 会暂停运行并持久化检查点；之后从其 flow-out 恢复继续。`,
    )
  } else {
    lines.push('- 本工作流无暂停节点。')
  }

  lines.push(`- 运行参数：${(dynamic.runParamsText ?? '').trim() || '（无）'}`)
  if (dynamic.question) {
    lines.push(`- 用户问题（服务模式）：${dynamic.question}`)
  }
  // 情况2：父代理自执行单元任务块注入末段（动态值仅末段；本 run 内字节稳定）
  if (dynamic.parentTaskBlock) {
    lines.push('')
    lines.push('【你的节点任务】（执行者模式：以下任务由你亲自执行，不得下发）：')
    lines.push(dynamic.parentTaskBlock)
  }
  return lines.join('\n')
}