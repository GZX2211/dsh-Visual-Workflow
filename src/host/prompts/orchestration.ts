// src/host/prompts/orchestration.ts
//
// 编排指令模板构建器。
//
// 上下文：本指令文本由编排器在 startRun 时一次性 followup 注入「父代理」主会话，
//       指导父代理按 流程事实源（orchestrations/<runId>.json）自主调度节点子代理、
//       判断条件连线、并在失控或正常走完时 wf_finish 收尾。
//
// 稳定布局（前缀稳定 + 关键约束双位 + 动态值仅注入末尾）：
//   ① 首段 = 硬约束（仅调度不执行 / wf_run_node 异步 / wf_finish 幂等收尾 / 失败语义 /
//            条件连线由父代理语义判断 / 空载与调用上限护栏 / 失控立即 wf_finish(failed)）
//   ② 中段 = 过程性信息（事实源路径 / 节点清单 / 协作组并行说明）
//   ③ 末段 = 关键约束重申 + 本次动态状态（断点继续 / 暂停 / 运行参数等动态值仅在此注入）
//
// 为什么动态值只在末段（前缀稳定 / KV 缓存友好）：同一 run 内本模板字符串
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
    /**
     * 模式二本次外部请求的用户问题（不稳定内容，仅末段注入；模式一无）。
     */
    question?: string
  }
}

/**
 * 关键约束的核心短语（首段与末段同时出现，供 W-02 双位测试断言与组装任务引用）。
 * 用中文面向模型（W-04）；工具名与工具 schema 描述保留英文（W-03）；保持措辞独立于动态值，避免前缀漂移。
 */
export const ORCH_HARD_CONSTRAINTS = {
  /** 父代理「仅调度不执行」核心短语（首段硬约束 + 末段重申双位出现）。 */
  dispatchOnly: '仅编排：你只负责调度子代理，不亲自执行节点任务',
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
  /** 护栏：失控立即 wf_finish(failed)。 */
  failureImmediate: "检测到失控时立即调用 wf_finish({ status: 'failed' })",
  /** 协作通信超时处置：征询用户后 resolve 三动作。 */
  askAgentTimeout:
    '收到 wf_ask_agent 的 ask 超时通知时，先用 ask_user_question 征询用户，再用 wf_ask_agent resolve（continue / resend / abort）定案',
} as const

/**
 * 编排指令模板构建器（纯函数）。
 *
 * 输出字符串同一 run 内字节稳定：首段硬约束 + 中段过程性信息固定；
 * 末段重申固定，之后仅追加本次动态状态（facts/dynamic 决定）。不读时钟、不随机。
 *
 * @param params - 模板入参（facts 静态事实 + dynamic 末段动态状态）。
 * @returns 注入父代理的编排指令文本（面向模型，中文）。
 */
export function buildOrchestrationDirective(params: OrchestrationDirectiveParams): string {
  const { facts, dynamic } = params

  // —— 首段：硬约束（最重要约束置于开头，注意力第一位）——
  const nodeList = facts.nodes.map((n) => `- ${n.id} (${n.label})`).join('\n')
  const collabText =
    facts.collabGroups.length === 0
      ? '无协作组。'
      : facts.collabGroups
          .map((g) => `- ${g.groupId}（${g.label}）：并行启动成员 [${g.memberIds.join(', ')}]`)
          .join('\n')

  const head = [
    HEAD_MARKER,
    '',
    `你是工作流「${facts.workflowName}」的编排父代理。`,
    '',
    `1. ${ORCH_HARD_CONSTRAINTS.dispatchOnly}。`,
    `2. 调用协议：${ORCH_HARD_CONSTRAINTS.runNodeAsync}；${ORCH_HARD_CONSTRAINTS.runNodeBlocking}。`,
    `3. 收尾协议：${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `4. 失败语义：${ORCH_HARD_CONSTRAINTS.failureSemantics}；在节点限额内重试、询问用户，或显式终止本次运行。`,
    `5. 条件连线：${ORCH_HARD_CONSTRAINTS.conditionSemantics}。`,
    `6. 护栏：wf_run_node 全局调用上限 500 次；无节点在途时触发空闲超时。`,
    `7. 失控处理：${ORCH_HARD_CONSTRAINTS.failureImmediate}。`,
    `8. 组内通信：${ORCH_HARD_CONSTRAINTS.askAgentTimeout}。`,
  ].join('\n')

  // —— 中段：过程性信息（节点清单 / 事实源路径 / 协作组并行说明）——
  const mid = [
    MID_MARKER,
    '',
    `工作流事实源（只读文件）：${facts.definitionPath} —— 请先读取它，以获取完整节点列表与连线语义。`,
    `⚠ 运行期间画布保存会刷新本文件（双向同步）：节点清单可能变化，请每次调度前重新读取事实源文件，以文件最新内容为准（下方「待编排节点」仅作启动时快照参考，不作为调度依据）。`,
    `工作流目标：${facts.workflowGoal.trim() || '（无描述）'}`,
    '',
    '待编排节点（启动时快照，非权威）：',
    nodeList,
    '',
    '协作组（并行成员）：',
    collabText,
  ].join('\n')

  // —— 末段：关键约束重申 + 本次动态状态（动态值仅在此注入）——
  const tail = [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- ${ORCH_HARD_CONSTRAINTS.dispatchOnly}。`,
    `- ${ORCH_HARD_CONSTRAINTS.finishIdempotent}。`,
    `- ${ORCH_HARD_CONSTRAINTS.failureSemantics}；${ORCH_HARD_CONSTRAINTS.failureImmediate}（失控时）。`,
    '',
    renderDynamicState(dynamic),
  ].join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 渲染末段动态状态（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。
 */
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
  return lines.join('\n')
}
