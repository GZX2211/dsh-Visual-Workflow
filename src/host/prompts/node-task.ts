// src/host/prompts/node-task.ts
//
// 节点任务块构建器（T-005 基线之一，提示词准确性改造后重写）。
//
// 上下文：本任务文本由 wf_run_node 启动节点子代理时注入，作为子代理执行单节点
//       任务的「任务文本」。参考旧项目 VisualWorkflow/lib/orchestrator.js 的
//       buildNodeBlocks（L821-871）骨架，但按 §13.1 重构。
//
// 稳定布局（§13.1）：
//   ① 首段 = 该节点真正需要强调的**软约束固化**（AI 有选择权、值得强调的行为规则）
//             ——分词：report 工具一律软禁用（最终结论自动送达父代理、阶段汇报无意义）；
//             协作组成员必须经 wf_ask_agent 通信（仅组内节点注入）；
//   ② 中段 = 过程性信息（上游产出上下文（ctx 连线注入）/ 文件路径索引 / 数据库工具说明）
//   ③ 末段 = 软约束重申（W-02 双位）+ 动态态信息（本次执行的动态状态仅注入末尾）
//
// 代码层约束（引擎已强制、AI 无选择权）**不写入提示词**（用户裁决）：
//   - 「仅使用你自己的 System Prompt」：子代理只有一条 System Prompt，无需强调；
//   - 「只调用允许清单内的工具」：工具可见性由引擎管理，AI 只能调用可见工具；
//   - 「重试/ReAct 迭代上限」：引擎护栏，数值对 AI 无执行意义；
//   这些条目从首段与末段重申中删除，以节省上下文、消除无用约束对模型的干扰。
//
//
// 构建器为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同；动态值仅注入末段。

import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js'

/**
 * 节点任务块的入参（中文注释每个字段）。
 * `facts` 为同一 run 内字节稳定的静态事实；`dynamic` 为仅注入末段的动态态信息。
 */
export interface NodeTaskBlockParams {
  /** 静态事实：节点身份 / 任务 / 上下文注入（同一 run 内稳定）。 */
  facts: {
    /**
     * 节点任务文本：节点自身的 System Prompt（persona），即子代理要完成的子任务。
     * 任务正文经 prompt-setup 作为系统提示词段注入，本任务块不再重复正文。
     */
    task: string
    /**
     * 节点人类可读名称（身份行与中段指代）。
     */
    nodeLabel: string
    /**
     * 上游产出上下文（ctx 连线注入）：上游节点最终产出摘要/产物文本，作为下游节点的
     * 上下文注入。数组元素为「来源 → 内容」键值；可为空（无 ctx 连线即不注入）。
     * 长文本（文档/上游产物）统一置于中段（lost-in-the-middle 处置）。
     */
    upstreamContext: Array<{ source: string; content: string }>
    /**
     * 文件路径索引：非文本文件节点连线注入的受管文件路径（data/files/），子代理经
     * 官方读取工具自行读取（不直通模型上下文）。可为空。
     */
    filePaths: string[]
    /**
     * 数据库工具说明：存在 db-in 连线时说明 wf_db_query 三模式（search/query/schema，
     * 只读）用法；无 db-in 连线时为空字符串。
     */
    dbToolHint: string
    /**
     * 协作组成员标记：该节点为协作组成员时注入「组内通信必须经 wf_ask_agent」软约束。
     */
    isGroupMember: boolean
  }
  /** 末段动态态信息（不稳定内容，仅注入尾段）。全部可选，缺省即默认值。 */
  dynamic: {
    /**
     * 暂停节点 id 清单：本节点若为其中一员（父代理对其调用 wf_run_node）将触发暂停门。
     * 缺省为无暂停语义（普通节点）。
     */
    pauseNodeIds?: string[]
    /**
     * 本次执行的额外运行上下文说明文本（如恢复自断点、attempt 次数等）。缺省为空。
     */
    runContextText?: string
  }
}

/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
 */
export const NODE_HARD_CONSTRAINTS = {
  /** report 工具一律软禁用：最终结论自动送达父代理，阶段汇报无意义。 */
  noReportTool: '不得调用 report 工具提交结论或阶段汇报',
  /** 协作组内通信必须经 wf_ask_agent（仅组内成员注入）。 */
  collabAskOnly: '与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）',
} as const

/**
 * 节点任务块构建器（纯函数）。
 *
 * 输出字符串同一 run 内字节稳定：首段软约束 + 中段过程性信息固定；末段重申固定，
 * 之后仅追加本次动态态信息。不读时钟、不随机。
 *
 * @param params - 模板入参（facts 静态事实 + dynamic 末段动态态信息）。
 * @returns 注入子代理的任务文本（面向模型，中文）。
 */
export function buildNodeTaskBlock(params: NodeTaskBlockParams): string {
  const { facts, dynamic } = params

  // —— 首段：软约束固化（注意力位置第一位；仅保留 AI 有选择权的行为规则）——
  const head = [
    HEAD_MARKER,
    '',
    `你正在执行节点「${facts.nodeLabel}」。`,
    '',
    `1. ${NODE_HARD_CONSTRAINTS.noReportTool}`,
    ...(facts.isGroupMember ? [`2. ${NODE_HARD_CONSTRAINTS.collabAskOnly}，不得用普通文本模拟对话或绕过工具直接发送消息。`] : []),
  ].join('\n')

  // —— 中段：过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）——
  const midParts: string[] = [
    MID_MARKER,
    '',
    `请执行工作流节点「${facts.nodeLabel}」`,
  ]

  if (facts.upstreamContext.length > 0) {
    midParts.push('', '上游产出（经 ctx 连线注入）：')
    for (const entry of facts.upstreamContext) {
      midParts.push(`- ${entry.source}：${entry.content}`)
    }
  } else {
    midParts.push('', '上游产出：（无）')
  }

  if (facts.filePaths.length > 0) {
    midParts.push('', '文件路径索引（自行读取）：')
    for (const filePath of facts.filePaths) {
      midParts.push(`- ${filePath}`)
    }
  }

  if (facts.dbToolHint.trim()) {
    midParts.push('', `数据库工具说明：${facts.dbToolHint.trim()}`)
  }

  const mid = midParts.join('\n')

  // —— 末段：软约束重申（W-02 双位）+ 动态态信息（动态值仅在此注入）——
  const tail = [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- ${NODE_HARD_CONSTRAINTS.noReportTool}。`,
    ...(facts.isGroupMember ? [`- ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`] : []),
    '',
    renderDynamicState(dynamic),
  ].join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 渲染末段动态态信息（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。
 * 重试上限 / ReAct 迭代上限为引擎层护栏，AI 无选择权，不再写入（用户裁决）。
 */
function renderDynamicState(dynamic: NodeTaskBlockParams['dynamic']): string {
  const lines: string[] = ['当前执行状态：']

  const pauseIds = dynamic.pauseNodeIds && dynamic.pauseNodeIds.length > 0 ? dynamic.pauseNodeIds : null
  if (pauseIds) {
    lines.push(`- 暂停节点：[${pauseIds.join(', ')}]。若你属于其中之一，本节点作为纯流程门（暂停运行）。`)
  } else {
    lines.push('- 本流程无暂停节点。')
  }

  lines.push(`- 运行上下文：${(dynamic.runContextText ?? '').trim() || '（无）'}`)
  return lines.join('\n')
}