// src/host/prompts/child.ts
//
// 子代理侧提示词构建器：节点任务块（每次运行注入的那一段）。
// 正文全部在 texts/child-node-task.ts；本文件只把事实翻译成模板变量并渲染一次。

import { isEnglishSystemLanguage } from '../system-language.js'
import { localizeOutputContract } from './defaults.js'
import { flag, renderTemplate } from './render.js'
import { CHILD_NODE_TASK } from './texts/child-node-task.js'
import { CHILD_NODE_TASK_EN } from './texts/en/child-node-task.js'

/**
 * 可通信对象（子代理可经 wf_send_message 触达的对象）。
 * 父代理是固定别名 `parent`；组内成员以 nodeId 寻址（同一套 ID 覆盖普通子代理与
 * Team 成员，投递通道由插件内部解析）。
 */
export interface CommTarget {
  /** 角色名称（父代理为「父代理」）。 */
  label: string
  /** 寻址标识（父代理为 'parent'，成员节点为 nodeId）。 */
  id: string
}

/** 节点任务块的入参（facts 为同一 run 内字节稳定的静态事实）。 */
export interface NodeTaskBlockParams {
  facts: {
    /** 节点人类可读名称（身份行与中段指代）。 */
    nodeLabel: string
    /** 上游产出上下文（全链路自动注入），可为空。 */
    upstreamContext: Array<{ nodeId: string; source: string; content: string }>
    /** 数据库工具说明（存在 db-in 连线时说明 wf_db_query 三模式），无则空字符串。 */
    dbToolHint: string
    /**
     * 可通信对象清单：父代理 + 本组其他成员节点（非组内成员只有父代理）。
     * 上下游节点 id 不进本清单——可通信面只由组关系决定。
     */
    commTargets: CommTarget[]
    /** Team 卡片上用户自定义的协作说明（为空则不组装该段）。 */
    collabNote?: string
    /** 输入契约（节点配置 data.inputSchema）；为空则不组装该段。 */
    inputContract: string
    /** 输出契约（节点配置 data.outputSchema）；为空则不组装该段。 */
    outputContract: string
    /** 系统语言名（如 '中文' / 'English'）。 */
    systemLanguage: string
  }
}

/** 节点任务块构建器（纯函数）：注入子代理「本轮该干什么 + 手上有什么 + 能找谁」的完整文本。 */
export function buildNodeTaskBlock(params: NodeTaskBlockParams): string {
  const { facts } = params
  const english = isEnglishSystemLanguage(facts.systemLanguage)
  return renderTemplate(english ? CHILD_NODE_TASK_EN : CHILD_NODE_TASK, {
    nodeLabel: facts.nodeLabel,
    systemLanguage: String(facts.systemLanguage ?? '').trim(),
    upstreamEntries: facts.upstreamContext
      .map((entry) => english
        ? `- ${entry.source} (id: ${entry.nodeId}): ${entry.content}`
        : `- ${entry.source}（id：${entry.nodeId}）：${entry.content}`)
      .join('\n'),
    noUpstream: flag(facts.upstreamContext.length === 0),
    inputContract: String(facts.inputContract ?? '').trim(),
    dbToolHint: String(facts.dbToolHint ?? '').trim(),
    outputContract: localizeOutputContract(facts.outputContract, facts.systemLanguage),
    commTargets: (facts.commTargets ?? [])
      .map((target) => english ? `- ${target.label} (${target.id})` : `- ${target.label}（${target.id}）`)
      .join('\n'),
    collabNote: String(facts.collabNote ?? '').trim(),
  })
}
