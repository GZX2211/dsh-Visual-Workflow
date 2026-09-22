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
//             ——系统语言规则 + 协作组成员必须经 wf_ask_agent 通信（仅组内节点注入）；
//   ② 中段 = 过程性信息（上游产出上下文（ctx 连线注入）/ 文件路径索引 / 数据库工具说明）
//   ③ 末段 = 软约束重申（W-02 双位）
//
// 构建器为纯函数：不读 Date.now/随机源，同一 params 两次构建字节相同。

import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from './markers.js'
import { systemLanguageRule } from './prompt-rules.js'

/**
 * 节点任务块的入参（中文注释每个字段）。
 * `facts` 为同一 run 内字节稳定的静态事实；构建器不注入任何动态态信息，
 * 故不设 dynamic 段（动态段属编排系指令的形态，节点任务块没有此类内容）。
 */
export interface NodeTaskBlockParams {
  /** 静态事实：节点身份 / 上下文注入（同一 run 内稳定）。 */
  facts: {
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
    /**
     * 输入结构说明（节点配置 data.inputSchema）：告诉该子代理「应当收到什么输入」，
     * 避免它重复索要上游已提供的信息。为空则不组装该段。
     */
    inputContract: string
    /**
     * 交接契约（节点配置 data.outputSchema，或系统的默认结构）：该子代理的最终回复
     * 会被下游 ctx 连线节点**直接读取**，故须按此结构组织。为空则不组装该段。
     * 注意这是**柔性文本契约**（用户裁决 A3：不做结构校验），只影响提示词，不参与校验。
     */
    outputContract: string
    /**
     * 交接契约是否来自系统默认结构（节点未配置 outputSchema，且该节点存在 ctx-out 出线）。
     * true 时声明中提到「本结构由系统默认给出」，便于模型区分用户定制与默认。
     */
    outputContractDefaulted: boolean
    /**
     * 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。
     * 注入「所有对话回复、注释、思考过程必须使用该语言」规则。
     */
    systemLanguage: string
  }
}

/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
 */
export const NODE_HARD_CONSTRAINTS = {
  /** 协作组内通信必须经 wf_ask_agent（仅组内成员注入）。 */
  collabAskOnly: '与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）',
} as const

/**
 * 默认交接契约的字段清单（系统兜底用；用户裁决：有 ctx-out 出线且未配置 outputSchema 时注入）。
 * 为什么是这四项：下游节点经 ctx 连线读到的就是本节点的**最终回复文本**，
 * 它需要能据此判断「结论是什么、产物在哪、有哪些已定决策、还剩什么没定」——
 * 大产物本身一律落盘（写在路径里），不靠回复正文传递。
 */
export const DEFAULT_OUTPUT_CONTRACT =
  '结论 / 产出文件路径 / 关键决策 / 未决问题'

/**
 * 交接契约声明句（末段复用默认结构短语；术语一致性由 DEFAULT_OUTPUT_CONTRACT 保证）。
 * 模块内部 helper（仅本文件使用，不经公共入口公开）。
 * @param defaulted true = 这段结构是系统默认给出的（节点未配置），可用但可自行细化
 */
function outputContractRule(defaulted: boolean): string {
  const base = `你的最终回复会被下游节点直接读取，必须包含：${DEFAULT_OUTPUT_CONTRACT}`
  return defaulted ? `${base}（这套结构是本节点的默认交接格式）` : base
}

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
  const { facts } = params

  // —— 首段：软约束固化（注意力位置第一位；仅保留 AI 有选择权的行为规则）——
  const headLines: string[] = [
    HEAD_MARKER,
    '',
    `你正在执行节点「${facts.nodeLabel}」。`,
    '',
  ]

  if (facts.systemLanguage.trim()) {
    headLines.push(`1. ${systemLanguageRule(facts.systemLanguage)}。`)
  }

  if (facts.isGroupMember) {
    // 若已有语言规则，编号顺延为 2；否则为 1
    const idx = facts.systemLanguage.trim() ? 2 : 1
    headLines.push(`${idx}. ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`)
  }

  const head = headLines.join('\n')

  // —— 中段：系统语言规则 + 过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）——
  const midParts: string[] = [
    MID_MARKER,
    '',
  ]

  if (facts.upstreamContext.length > 0) {
    midParts.push('', '上游产出：')
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

  if (facts.inputContract.trim()) {
    midParts.push('', '输入结构（你应当收到的输入）：', facts.inputContract.trim())
  }

  if (facts.dbToolHint.trim()) {
    midParts.push('', `数据库工具说明：${facts.dbToolHint.trim()}`)
  }

  const mid = midParts.join('\n')

  // —— 末段：软约束重申（W-02 双位） + 交接契约（注意力末位 = 最终回复格式的最后一次提醒）——
  const tailLines: string[] = [TAIL_MARKER, '']
  const restate: string[] = []
  if (facts.isGroupMember) restate.push(`- ${NODE_HARD_CONSTRAINTS.collabAskOnly}。`)
  const outputContract = facts.outputContract.trim()
  if (outputContract) {
    // 节点自配置时逐字使用其结构；未配置（系统兜底）时同时给出标准字段清单，
    // 避免下游契约退化成「随便说说」。
    restate.push(facts.outputContractDefaulted
      ? `- ${outputContractRule(true)}：${outputContract}。`
      : `- 你的最终回复会被下游节点直接读取，必须包含：${outputContract}。`)
  }
  if (restate.length > 0) tailLines.push(TAIL_RESTATE_MARKER, ...restate)
  const tail = tailLines.join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}