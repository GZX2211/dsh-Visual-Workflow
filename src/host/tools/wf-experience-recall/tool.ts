// src/host/tools/wf-experience-recall/tool.ts
//
// wf_experience_recall 工具注册：当前主体对自己已学经验的语义回忆。
//   第一阶段 query → 候选摘要；第二阶段 ids → 完整经验内容（该阶段即「使用事实」边界）。
//
// 职责边界：本文件只做「注册 + 适配」——两阶段入参判定、调用宿主能力缝、投影返回体。
// 检索、排序、摘要生成、使用事实记录与主体边界全部归 domain 层；本工具不改写经验本体、
// 不重算排序，也不调用任何其它 Tool 的注册/执行函数。
//
// 与 wf_org_catalog 的分工：后者勘察组织资产（工作流/角色资产），不再承担经验召回。
//
// 提示词规范：description 用官方标准英文，回答「何时调用 / 调用前需要什么 / 失败时
// 会发生什么 / 是否产生副作用」。

import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_RECALL_FAILED, WF_EXPERIENCE_RECALL } from '../../shared/protocol.js'
import { MAX_RECALL_IDS, recallIdsLimitProblem } from '../../experience/constants.js'
import { WfError, messageOf } from '../../orchestrator/index.js'
import { experienceCallerOf } from '../infrastructure/caller.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from '../infrastructure/define-tool.js'
import { EXPERIENCE_TYPE_PARAM_DESCRIPTION, assertExperienceTypeOwnership, parseExperienceType, type WfExperienceHost } from '../infrastructure/experience-contract.js'
import { candidateResultOf, detailsResultOf, renderRecallResult } from './build.js'
import type { RecallResult } from './types.js'

/** 非空字符串归一（缺失/非字符串 → 空串）。 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * ids 归一化：缺省 / 空数组 / 空白串视为未传；空白项跳过，按首次出现去重（保持模型给出的顺序）。
 * @returns 归一化后的 id 列表；`null` 表示形状非法（调用方抛 WF_EXPERIENCE_BAD_ARGS）。
 */
function normalizeRecallIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') return raw.trim() ? null : []
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const item of raw) {
    const id = String(item ?? '').trim()
    if (!id || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * topK 归一化：未传即 undefined；非正有限整数返回 null（调用方抛 WF_EXPERIENCE_BAD_ARGS）。
 * 只接受整数，因为它是候选条数上限——小数会得到无法解释的截断数量。
 */
function normalizeTopK(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) return null
  return raw
}

/**
 * 注册 wf_experience_recall（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfExperienceRecall(
  ctx: { get(name: string): unknown },
  host: WfExperienceHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_experience_recall')
  }

  const definition = defineTool({
    name: WF_EXPERIENCE_RECALL,
    description:
      'Recall the experiences your current subject has already learned, to inform the decision you are about to make. Recall happens at the start of a task or while it is running. It is a two-stage call: query returns ranked candidate summaries [{id, score, summary, source}], then ids returns the full experience entries. source is "semantic" for embedding search or "bm25" for the lexical fallback. '
      + 'A candidate score adjusts relevance by a bounded trust correction; trust can never outweigh relevance, so prefer clearly more relevant candidates over high-trust but weakly related ones. '
      + 'After you use recalled experiences, rate them with wf_experience_feedback in the final completion stage of that same task. '
      + 'Reading candidates changes nothing and can be repeated safely; reading full entries by ids is what makes them count as used, which later allows rating them with wf_experience_feedback. Only experiences of the subject type you pass are returned, so a child agent may only pass type "agent" (otherwise WF_EXPERIENCE_WRONG_TYPE). '
      + `Failure semantics: a missing or invalid type, mixed-stage arguments, malformed ids and topK, or more than ${MAX_RECALL_IDS} ids in the second stage fail with WF_EXPERIENCE_BAD_ARGS; an unknown id fails with WF_EXPERIENCE_NOT_FOUND; a retrieval failure fails with WF_EXPERIENCE_RECALL_FAILED.`,
    parameters: {
      type: {
        type: 'string',
        enum: ['agent', 'team', 'orchestrator'],
        required: true,
        description: EXPERIENCE_TYPE_PARAM_DESCRIPTION,
      },
      query: {
        type: 'string',
        description: 'Natural-language description of the decision or situation you are facing; first stage of the two-stage call. Pass either query or ids, never both.',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Experience ids to read in full; second stage, after the candidate summaries looked relevant. Pass either ids or query, never both.',
      },
      topK: {
        type: 'integer',
        description: 'Optional maximum number of candidate summaries in the query stage (positive integer). Query stage only.',
      },
    },
    output: {
      // additionalProperties: true：宿主按 output.schema 校验返回体，而本工具是双态返回
      // （candidates / details）；闭合声明会把成功调用变成宿主校验错误。
      schema: {
        type: 'object',
        additionalProperties: true,
        description: 'kind="candidates": hits ([{id, score, summary, source}]) where score is semantic relevance with a bounded trust correction, plus source ("semantic" or "bm25"). kind="details": entries (full experience entries for the requested ids).',
      },
      render: renderRecallResult,
    },
    async execute(args: Record<string, unknown>, exec: ToolExecLike): Promise<RecallResult> {
      const caller = experienceCallerOf(exec)
      if (!caller.sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session, so the experience subject cannot be resolved', 'WF_BAD_CALLER')
      const type = parseExperienceType(args?.type)
      assertExperienceTypeOwnership(caller, type)

      const query = textOf(args?.query)
      const ids = normalizeRecallIds(args?.ids)
      if (ids === null) {
        throw new WfError('WF_EXPERIENCE_BAD_ARGS: ids must be an array of strings (the second stage reads full entries by id)', ERR_EXPERIENCE_BAD_ARGS)
      }
      // 条数上限属经验域口径：在工具边界先拒绝，模型拿到的是可行动提示与稳定错误码，
      // 而不是抵达 SQLite 之后才暴露的绑定变量越界。
      const idsLimitProblem = recallIdsLimitProblem(ids.length)
      if (idsLimitProblem !== null) {
        throw new WfError(`WF_EXPERIENCE_BAD_ARGS: ${idsLimitProblem}`, ERR_EXPERIENCE_BAD_ARGS)
      }
      const topK = normalizeTopK(args?.topK)
      if (topK === null) {
        throw new WfError('WF_EXPERIENCE_BAD_ARGS: topK must be a positive integer (the cap on candidate summaries in the query stage)', ERR_EXPERIENCE_BAD_ARGS)
      }
      // 两个阶段的取数语义不同（模糊检索 vs 精确取回），混用会让「返回什么」不可预测
      if (query && ids.length > 0) {
        throw new WfError(
          '本工具是两阶段调用：先用 query 取候选摘要，再用 ids 取回完整内容；两者不要在同一次调用中混用',
          ERR_EXPERIENCE_BAD_ARGS,
        )
      }
      if (!query && ids.length === 0) {
        throw new WfError(
          '请传 query（第一阶段取候选摘要）或非空 ids（第二阶段取完整经验）：两者都不传时无法召回任何经验',
          ERR_EXPERIENCE_BAD_ARGS,
        )
      }
      if (ids.length > 0 && topK !== undefined) {
        throw new WfError('WF_EXPERIENCE_BAD_ARGS: topK belongs to the query stage only; the ids stage reads exact entries and has no candidate cap', ERR_EXPERIENCE_BAD_ARGS)
      }

      try {
        const result = await host.experience.recall({
          caller,
          type,
          ...(query ? { query } : {}),
          ...(ids.length > 0 ? { ids } : {}),
          ...(topK !== undefined ? { topK } : {}),
        })
        return result.kind === 'candidates'
          ? candidateResultOf(result.hits, result.source)
          : detailsResultOf(result.entries)
      } catch (error) {
        // 稳定错误码是跨模块契约：domain 抛出的错误原样上抛；其它失败对模型只有
        // 「召回失败」一种语义，归一到稳定码并保留原始消息以便诊断。
        if (error instanceof WfError) throw error
        throw new WfError(messageOf(error), ERR_EXPERIENCE_RECALL_FAILED)
      }
    },
  })

  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为（工具可能已被外部注销）
    }
  }
}
