// src/host/tools/wf-experience-feedback/tool.ts
//
// wf_experience_feedback 工具注册：提交「已召回的 Experience 被使用后的评价」。
//
// 职责边界：本文件只做「注册 + 适配」——调用方身份派生、主体类型校验、把模型侧入参交给
// apply.ts 做映射与锚点校验、调用宿主能力缝、投影模型可见返回体。准入判定（是否真被显式
// 注入过）、评价入库与统计重算全部归经验域；工具层不改经验本体、不落盘、不重算公式，
// 也不调用任何其它 Tool 的注册/执行函数（与 wf_experience_learn 共享的只有基础设施层契约）。
//
// 提示词规范：description 用官方标准英文，回答「何时调用 / 调用前需要什么 / 失败时会发生
// 什么 / 是否产生副作用」，并明确「反馈与学习同属任务最终完成阶段，召回发生在任务开始或
// 执行途中」。
import { DECISION_EFFECT_ANCHORS, SCORE_ANCHORS, renderAnchorGlossary, } from '../../experience/index.js';
import { ERR_EXPERIENCE_FEEDBACK_FAILED, WF_EXPERIENCE_FEEDBACK } from '../../shared/protocol.js';
import { WfError, messageOf } from '../../orchestrator/index.js';
import { experienceCallerOf } from '../infrastructure/caller.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { assertExperienceTypeOwnership, parseExperienceType } from '../infrastructure/experience-contract.js';
import { textRender } from '../infrastructure/text-render.js';
import { parseFeedbackEvaluations, projectFeedbackResult } from './apply.js';
/**
 * 注册 wf_experience_feedback（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfExperienceFeedback(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_experience_feedback');
    }
    const definition = defineTool({
        name: WF_EXPERIENCE_FEEDBACK,
        description: 'Submit how the experiences you actually used in this unit of work affected your decisions, so the shared library can learn which ones deserve trust. Call it in the final completion stage of a task, together with wf_experience_learn: recall happens at the start of a task or while it is running, and rating what was used belongs to the end. '
            + 'Preconditions: every experience_id must be one this subject actually had injected into its context through wf_experience_recall; experiences never used cannot be rated and come back in skipped. '
            + `Score each evaluation only by choosing a semantic anchor level, never an arbitrary decimal. The four dimensions with the behaviour definition of every level, in snake_case: ${renderAnchorGlossary()} `
            + 'decision_effect is not how much you like the experience. evidence is optional free text naming the facts behind the rating; unknown fields are rejected instead of being dropped. '
            + 'Failure semantics: an off-anchor score, an unknown field, a missing or duplicate experience_id, too many evaluations, or over-long evidence fails the whole call with WF_EXPERIENCE_BAD_ARGS and nothing is recorded; a child agent may only pass type "agent" (WF_EXPERIENCE_WRONG_TYPE); a storage or aggregation failure fails with WF_EXPERIENCE_FEEDBACK_FAILED and can be retried. '
            + 'Side effects: accepted evaluations append to the immutable rating history and immediately re-aggregate that experience statistics, which the next recall uses as a bounded trust adjustment of at most ±20%; ratings can never be edited or deleted, and the experience content itself is never modified.',
        parameters: {
            type: {
                type: 'string',
                enum: ['agent', 'team', 'orchestrator'],
                required: true,
                description: 'Subject type whose experiences you are rating: "agent" for an execution subject (including child agents), "team" for a collaboration group, "orchestrator" for the orchestrating parent. A child agent may only pass "agent".',
            },
            evaluations: {
                type: 'array',
                required: true,
                description: 'The experiences you used in this unit of work, one evaluation each; experiences that were not actually used are reported as skipped.',
                items: {
                    // additionalProperties: true 是既定范式（与 wf_experience_learn 同）：未知字段必须
                    // 抵达执行期由本工具明确拒绝，才能在拒绝时给出 WF_EXPERIENCE_BAD_ARGS 与字段名。
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        experience_id: { type: 'string', description: 'Id of an experience this subject had injected into its context through wf_experience_recall.' },
                        fit: { type: 'number', enum: [...SCORE_ANCHORS], description: 'Applicability of the experience to this situation.' },
                        decision_effect: { type: 'number', enum: [...DECISION_EFFECT_ANCHORS], description: 'How much the decision or outcome actually changed compared with not using the experience; negative means it hurt.' },
                        information_gain: { type: 'number', enum: [...SCORE_ANCHORS], description: 'How much decision information with real discriminating power the experience provided here.' },
                        causal_confidence: { type: 'number', enum: [...SCORE_ANCHORS], description: 'How confident you are that this effect came from the experience rather than from your own actions, external systems or chance.' },
                        evidence: { type: 'string', description: 'Optional facts that support this rating; not a run log.' },
                    },
                },
            },
        },
        output: {
            // additionalProperties: true：宿主按 output.schema 校验返回体，而本工具返回
            // accepted / skipped 两个数组；闭合声明会把成功调用变成宿主校验错误。
            schema: {
                type: 'object',
                additionalProperties: true,
                description: 'accepted: the evaluations that were written ([{experienceId, fitScore, decisionEffect, informationGain, causalConfidence}]). skipped: the evaluations that were not accepted ([{experienceId, reason}]), because that experience had not been used.',
            },
            render: textRender,
        },
        async execute(args, exec) {
            const caller = experienceCallerOf(exec);
            if (!caller.sessionId)
                throw new WfError('无法识别调用者会话，无法确定经验归属的主体', 'WF_BAD_CALLER');
            const type = parseExperienceType(args?.type);
            assertExperienceTypeOwnership(caller, type);
            // 参数错误在本行之前就已定型（工具层自造 WF_EXPERIENCE_BAD_ARGS），
            // 因此域层调用之外的失败只剩「意外异常」一种语义。
            const evaluations = parseFeedbackEvaluations(args?.evaluations);
            try {
                const result = await host.experience.feedback({ caller, type, evaluations });
                return projectFeedbackResult(result);
            }
            catch (error) {
                // 稳定错误码是跨模块契约：域层已判定的错误（主体职责不符、准入参数、写入失败）原样上抛，
                // 再包一层会丢掉域层给出的可行动恢复动作。
                if (error instanceof WfError)
                    throw error;
                // 没有稳定码的意外异常对模型只有「反馈没成功」一种语义；经验本体不受影响是设计保证
                // （§35），因此恢复动作是重试而不是「先确认经验是否被改坏」。
                throw new WfError(`评价提交失败（${messageOf(error)}）：经验本体未被改动，可稍后重试；若持续失败请检查经验库可用性。`, ERR_EXPERIENCE_FEEDBACK_FAILED);
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