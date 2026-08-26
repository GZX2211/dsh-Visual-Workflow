// src/host/prompts/node-task.ts
//
// 节点任务块构建器（T-005 基线之一）。
//
// 上下文：本任务文本由 wf_run_node 启动节点子代理时注入，作为子代理执行单节点
//       任务的「任务文本」。参考旧项目 VisualWorkflow/lib/orchestrator.js 的
//       buildNodeBlocks（L821-871）骨架，但按 §13.1 重构。
//
// 稳定布局（§13.1）：
//   ① 首段 = 该节点最重要的约束（仅用自身 System Prompt / 工具白名单边界 /
//            失败语义：回流重试上限 + ReAct 软截停 / 成功时调用 report 回传结论摘要）
//   ② 中段 = 过程性信息（上游产出上下文（ctx 连线注入）/ 文件路径索引 / 数据库工具说明）
//   ③ 末段 = 重申 + 动态态信息（本次执行的动态状态仅注入末尾）
//
// 为什么上游产出等长文本置于中段（§13.1.2 lost-in-the-middle）：长文本放入任务主体
// 中部之后（本模板即中段），关键约束保持在首段与末段两端最受注意力关注的位置；关键
// 结论不由子代理粘贴大段原文，而由 report 摘要回传父代理（工具描述 §8 索引 #8/#19）。
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
     * 可为空字符串（模板提供兜底占位）。
     */
    task: string
    /**
     * 节点人类可读名称（用于「仅用自身 System Prompt」约束的指代与占位）。
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
     * 只读）用法；无 db-in 连线时为空字符串（工具不入白名单，也不写说明）。
     */
    dbToolHint: string
    /**
     * 工具白名单边界说明文本：该节点被注入的允许工具清单说明（resolveAgentTools 解析
     * 结果），用于首段「工具白名单边界」约束。可为空字符串（无额外白名单说明时）。
     */
    toolAllowlistNote: string
  }
  /** 末段动态态信息（不稳定内容，仅注入尾段）。全部可选，缺省即默认值。 */
  dynamic: {
    /**
     * 回流重试上限（本次执行生效值，默认 3）：单节点执行重复尝试上限，超限按护栏终止该节点。
     */
    retryLimit?: number
    /**
     * ReAct 迭代次数上限（本次生效值，可选）：单回合「思考-行动」循环软截停阈值，
     * 达到后工具调用被拒、强制输出结论后正常结束（react-capped，非失败）。
     */
    reactLimit?: number
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
 * 节点任务块首段关键约束短语（供 W-02 双位测试与后续组装任务引用，面向模型英文）。
 */
export const NODE_HARD_CONSTRAINTS = {
  /** 仅用自身 System Prompt（不继承父代理提示词）。 */
  ownPromptOnly: 'work from your own System Prompt only',
  /** 工具白名单边界：仅调用允许清单内的工具。 */
  allowlistOnly: 'call only tools within your allow-list',
  /** 失败语义：回流量试上限 / ReAct 软截停。 */
  retryAndReact: 'retry is bounded; reaching the ReAct iteration limit force-closes your turn',
  /** 成功收尾：调用 report 回传结论摘要。 */
  reportSummary: 'call report once before finishing with a self-contained summary',
} as const

/**
 * 节点任务块构建器（纯函数）。
 *
 * 输出字符串同一 run 内字节稳定：首段约束 + 中段过程性信息固定；末段重申固定，
 * 之后仅追加本次动态态信息。不读时钟、不随机。
 *
 * @param params - 模板入参（facts 静态事实 + dynamic 末段动态态信息）。
 * @returns 注入子代理的任务文本（面向模型，英文）。
 */
export function buildNodeTaskBlock(params: NodeTaskBlockParams): string {
  const { facts, dynamic } = params

  // —— 首段：该节点最重要的约束（注意力位置第一位）——
  const head = [
    HEAD_MARKER,
    '',
    `You are executing node "${facts.nodeLabel}".`,
    '',
    `1. ${NODE_HARD_CONSTRAINTS.ownPromptOnly}: do not inherit any parent-agent prompt, memory, or context.`,
    `2. ${NODE_HARD_CONSTRAINTS.allowlistOnly}${facts.toolAllowlistNote ? ` (${facts.toolAllowlistNote})` : ''}; wf_run_node / wf_finish are never available to you.`,
    `3. ${NODE_HARD_CONSTRAINTS.retryAndReact}; after that, still emit your final conclusion and finish normally.`,
    `4. On success: ${NODE_HARD_CONSTRAINTS.reportSummary} — one conclusion plus key outputs/decisions (do not paste large raw text back to the parent).`,
  ].join('\n')

  // —— 中段：过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）——
  const midParts: string[] = [
    MID_MARKER,
    '',
      `Your task is defined in your own System Prompt; it is not repeated here. Execute workflow node "${facts.nodeLabel}" from that prompt.`,
  ]

  if (facts.upstreamContext.length > 0) {
    midParts.push('', 'Upstream output (injected via ctx edges):')
    for (const entry of facts.upstreamContext) {
      midParts.push(`- ${entry.source}: ${entry.content}`)
    }
  } else {
    midParts.push('', 'Upstream output: (none — no ctx edge into this node)')
  }

  if (facts.filePaths.length > 0) {
    midParts.push('', 'Managed file path index (read these files yourself via your read tools):')
    for (const filePath of facts.filePaths) {
      midParts.push(`- ${filePath}`)
    }
  }

  if (facts.dbToolHint.trim()) {
    midParts.push('', `Database tool note: ${facts.dbToolHint.trim()}`)
  }

  const mid = midParts.join('\n')

  // —— 末段：重申 + 动态态信息（动态值仅在此注入）——
  const tail = [
    TAIL_MARKER,
    '',
    TAIL_RESTATE_MARKER,
    `- ${NODE_HARD_CONSTRAINTS.ownPromptOnly}.`,
    `- ${NODE_HARD_CONSTRAINTS.allowlistOnly}.`,
    `- ${NODE_HARD_CONSTRAINTS.reportSummary}.`,
    '',
    renderDynamicState(dynamic),
  ].join('\n')

  return `${head}\n\n${mid}\n\n${tail}\n`
}

/**
 * 渲染末段动态态信息（内部纯函数）：仅依赖 dynamic 字段，输出不稳定内容。
 */
function renderDynamicState(dynamic: NodeTaskBlockParams['dynamic']): string {
  const lines: string[] = ['Current execution state:']

  lines.push(`- Retry limit: ${dynamic.retryLimit ?? 3}`)

  if (dynamic.reactLimit !== undefined) {
    lines.push(`- ReAct iteration limit: ${dynamic.reactLimit} (soft cap; tool calls are refused past it, then conclude).`)
  } else {
    lines.push('- ReAct iteration limit: (unset)')
  }

  const pauseIds = dynamic.pauseNodeIds && dynamic.pauseNodeIds.length > 0 ? dynamic.pauseNodeIds : null
  if (pauseIds) {
    lines.push(`- Pause nodes: [${pauseIds.join(', ')}]. If you are one of these, your node acts as a pure flow gate (pauses the run).`)
  } else {
    lines.push('- This node is a normal task node (no pause semantics).')
  }

  lines.push(`- Run context: ${(dynamic.runContextText ?? '').trim() || '(none)'}`)
  return lines.join('\n')
}
