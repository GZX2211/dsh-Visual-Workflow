// src/host/tools/wf-experience-recall/tool.ts
//
// wf_experience_recall 工具注册：当前主体对自己已学经验的语义回忆（只读）。
//   第一阶段 query → 候选摘要；第二阶段 ids → 完整经验内容。
//
// 职责边界：本文件只做「注册 + 适配」——两阶段入参判定、调用宿主能力缝、投影返回体。
// 检索、排序、摘要生成与主体边界全部归 domain 层；本工具零写操作、幂等、无副作用，
// 也不调用任何其它 Tool 的注册/执行函数。
//
// 与 wf_org_catalog 的分工：后者勘察组织资产（工作流/角色资产），不再承担经验召回。
//
// 提示词规范：description 用官方标准英文，回答「何时调用 / 调用前需要什么 / 失败时
// 会发生什么 / 是否产生副作用」。
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_RECALL_FAILED, WF_EXPERIENCE_RECALL } from '../../shared/protocol.js';
import { WfError, messageOf } from '../../orchestrator/index.js';
import { experienceCallerOf } from '../infrastructure/caller.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { assertExperienceTypeOwnership, parseExperienceType } from '../infrastructure/experience-contract.js';
import { candidateResultOf, detailsResultOf, renderRecallResult } from './build.js';
/** 非空字符串归一（缺失/非字符串 → 空串）。 */
function textOf(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * ids 归一化：缺省 / 空数组 / 空白串视为未传；空白项跳过，按首次出现去重（保持模型给出的顺序）。
 * @returns 归一化后的 id 列表；`null` 表示形状非法（调用方抛 WF_EXPERIENCE_BAD_ARGS）。
 */
function normalizeRecallIds(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (typeof raw === 'string')
        return raw.trim() ? null : [];
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const item of raw) {
        const id = String(item ?? '').trim();
        if (!id || out.includes(id))
            continue;
        out.push(id);
    }
    return out;
}
/**
 * topK 归一化：未传即 undefined；非正有限整数返回 null（调用方抛 WF_EXPERIENCE_BAD_ARGS）。
 * 只接受整数，因为它是候选条数上限——小数会得到无法解释的截断数量。
 */
function normalizeTopK(raw) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0)
        return null;
    return raw;
}
/**
 * 注册 wf_experience_recall（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfExperienceRecall(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_experience_recall');
    }
    const definition = defineTool({
        name: WF_EXPERIENCE_RECALL,
        description: 'Recall the experiences your current subject has already learned, to inform the decision you are about to make. It is a two-stage call: first pass a natural-language query to get ranked candidate summaries shaped as [{id, score, summary, source}], then pass the ids worth reading in a second call to get the full experience entries. The summary is produced by the retrieval layer, and source tells you which channel answered: "semantic" for embedding search, "bm25" for the lexical fallback. '
            + 'Use wf_org_catalog instead when you need to survey reusable organization assets (workflow assets and role assets): that tool inspects the organization, while this one recalls the learned experience of your own subject type. Both are usually useful before planning, and neither replaces the other. '
            + 'Read-only, idempotent and side-effect free: nothing is written or changed, and the ranking is never recalculated here. Only experiences of the subject type you pass are returned, so a child agent may only pass type "agent" (otherwise WF_EXPERIENCE_WRONG_TYPE). '
            + 'Failure semantics: a missing or invalid type, mixed-stage arguments, or malformed ids and topK fail with WF_EXPERIENCE_BAD_ARGS; an unknown id fails with WF_EXPERIENCE_NOT_FOUND; a retrieval failure fails with WF_EXPERIENCE_RECALL_FAILED.',
        parameters: {
            type: {
                type: 'string',
                enum: ['agent', 'team', 'orchestrator'],
                required: true,
                description: 'Subject type whose experiences you recall: "agent" for an execution subject (including child agents), "team" for a collaboration group, "orchestrator" for the orchestrating parent. A child agent may only pass "agent".',
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
                description: 'kind="candidates": hits ([{id, score, summary, source}]) plus source ("semantic" or "bm25"). kind="details": entries (full experience entries for the requested ids).',
            },
            render: renderRecallResult,
        },
        async execute(args, exec) {
            const caller = experienceCallerOf(exec);
            if (!caller.sessionId)
                throw new WfError('无法识别调用者会话，无法确定经验归属的主体', 'WF_BAD_CALLER');
            const type = parseExperienceType(args?.type);
            assertExperienceTypeOwnership(caller, type);
            const query = textOf(args?.query);
            const ids = normalizeRecallIds(args?.ids);
            if (ids === null) {
                throw new WfError('ids 必须是字符串数组（第二阶段按 id 取回完整经验）', ERR_EXPERIENCE_BAD_ARGS);
            }
            const topK = normalizeTopK(args?.topK);
            if (topK === null) {
                throw new WfError('topK 必须是正整数（query 阶段返回的候选条数上限）', ERR_EXPERIENCE_BAD_ARGS);
            }
            // 两个阶段的取数语义不同（模糊检索 vs 精确取回），混用会让「返回什么」不可预测
            if (query && ids.length > 0) {
                throw new WfError('本工具是两阶段调用：先用 query 取候选摘要，再用 ids 取回完整内容；两者不要在同一次调用中混用', ERR_EXPERIENCE_BAD_ARGS);
            }
            if (!query && ids.length === 0) {
                throw new WfError('请传 query（第一阶段取候选摘要）或非空 ids（第二阶段取完整经验）：两者都不传时无法召回任何经验', ERR_EXPERIENCE_BAD_ARGS);
            }
            if (ids.length > 0 && topK !== undefined) {
                throw new WfError('topK 只用于 query 阶段：ids 阶段按 id 精确取回，不涉及候选条数上限', ERR_EXPERIENCE_BAD_ARGS);
            }
            try {
                const result = await host.experience.recall({
                    caller,
                    type,
                    ...(query ? { query } : {}),
                    ...(ids.length > 0 ? { ids } : {}),
                    ...(topK !== undefined ? { topK } : {}),
                });
                return result.kind === 'candidates'
                    ? candidateResultOf(result.hits, result.source)
                    : detailsResultOf(result.entries);
            }
            catch (error) {
                // 稳定错误码是跨模块契约：domain 抛出的错误原样上抛；其它失败对模型只有
                // 「召回失败」一种语义，归一到稳定码并保留原始消息以便诊断。
                if (error instanceof WfError)
                    throw error;
                throw new WfError(messageOf(error), ERR_EXPERIENCE_RECALL_FAILED);
            }
        },
    });
    const dispose = tools.register(definition);
    return () => {
        try {
            dispose();
        }
        catch {
            // 注销尽力而为（工具可能已被外部注销）
        }
    };
}
//# sourceMappingURL=tool.js.map