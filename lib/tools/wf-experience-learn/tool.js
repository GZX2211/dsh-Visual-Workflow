// src/host/tools/wf-experience-learn/tool.ts
//
// wf_experience_learn 工具注册：主体自主学习的单工具双态入口。
//   空 experiences = 初始化（取当前主体类型的 active 生成 Prompt）；
//   非空 = 提交（经 domain 校验、去重后入库）。
//
// 职责边界：本文件只做「注册 + 适配」——入参形状判定、状态分派、调用宿主能力缝、
// 投影模型可见返回体。候选合法性、初始化状态、去重与持久化全部归 domain 层；工具层
// 不落盘、不重算检索投影。工具之间解耦：不调用任何其它 Tool 的注册/执行函数。
//
// 提示词规范：description 用官方标准英文，回答「何时调用 / 调用前需要什么 / 失败时
// 会发生什么 / 是否产生副作用」，并逐字段给出字数预算（数字取自经验域 FIELD_BUDGETS，
// 措辞只在工具层维护）：预算是生成引导而非校验规则，模型据此自我约束即可。
import { FIELD_BUDGETS, FIELD_LIMITS } from '../../experience/index.js';
import { ERR_EXPERIENCE_BAD_ARGS, WF_EXPERIENCE_LEARN } from '../../shared/protocol.js';
import { WfError } from '../../orchestrator/index.js';
import { experienceCallerOf } from '../infrastructure/caller.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { assertExperienceTypeOwnership, parseExperienceType } from '../infrastructure/experience-contract.js';
import { textRender } from '../infrastructure/text-render.js';
import { mapExperienceCandidates } from './apply.js';
/**
 * 标量字段的长度提示：预算（生成引导值）+ 上限（超过即拒绝的硬护栏）。
 * 数字取自经验域唯一本体；措辞属工具层——模型必须读成「引导」而不是「校验」。
 */
function scalarLengthNote(budget, cap) {
    return ` Aim for at most ${budget} characters; the cap is ${cap}.`;
}
/** 数组字段的长度提示：条数与单条长度都有预算与上限，两者都要交代。 */
function listLengthNote(items, element, itemCap, elementCap) {
    return ` At most ${items} items, each aimed at ${element} characters; the caps are ${itemCap} items of ${elementCap} characters.`;
}
/**
 * 注册 wf_experience_learn（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfExperienceLearn(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_experience_learn');
    }
    const definition = defineTool({
        name: WF_EXPERIENCE_LEARN,
        description: 'Learn the durable experiences from a finished unit of work, or fetch the generation prompt that tells you what to learn. Two call shapes share this tool: pass an empty experiences array to get the active Experience Generation Prompt for your current subject type, then pass candidate experiences to store them. Each candidate carries the nine semantic fields the prompt asks for, in snake_case: responsibility, task_type, decision_domain, situation, trigger, principle, recommended_action, exclusions (array of strings) and evidence (array of strings); unknown fields are rejected by validation instead of being silently dropped. '
            + `Field length: every field below states a generation budget in characters. Those budgets are prompt guidance, not a validation rule, so a slight overrun is still accepted; text that exceeds a field cap (or the total cap) fails the whole call with WF_EXPERIENCE_VALIDATION and nothing is recorded. Keep the nine fields of one candidate within about ${FIELD_BUDGETS.total} characters in total (cap ${FIELD_LIMITS.total}): a shorter candidate stays retrievable and cheap to recall. `
            + 'Preconditions: the prompt for the same type must be fetched in this run before any candidate is accepted, otherwise the call fails with WF_EXPERIENCE_NOT_INITIALIZED and you must fetch the prompt first. A generation prompt is shared by every subject of its type, so fetching it again is safe and idempotent. '
            + 'Failure semantics: a child agent may only pass type "agent" (WF_EXPERIENCE_WRONG_TYPE); a candidate that breaks the protocol fails the whole call with WF_EXPERIENCE_VALIDATION; malformed arguments fail with WF_EXPERIENCE_BAD_ARGS; when semantic embedding is unavailable nothing is written and the call fails with WF_EXPERIENCE_EMBEDDING_UNAVAILABLE. '
            + 'Side effects: a successful submission writes the accepted candidates into the shared experience library; near-duplicate experiences are skipped and reported in skipped with the reason instead of being stored twice. '
            + 'If this unit of work produced nothing worth keeping for the long term, do not submit anything: skip the learning step and end your turn.',
        parameters: {
            experiences: {
                type: 'array',
                required: true,
                description: 'Candidate experiences to store, or an empty array to fetch the generation prompt instead of storing anything. Each candidate carries the nine semantic fields the prompt asks for; unknown fields are rejected by validation, not dropped, and each field description below states its length budget.',
                items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        responsibility: { type: 'string', description: 'What the subject is responsible for in this unit of work.' + scalarLengthNote(FIELD_BUDGETS.responsibility, FIELD_LIMITS.responsibility) },
                        task_type: { type: 'string', description: 'Coarse task category label used for retrieval, not the concrete task name.' + scalarLengthNote(FIELD_BUDGETS.taskType, FIELD_LIMITS.taskType) },
                        decision_domain: { type: 'string', description: 'The class of decision this experience is about.' + scalarLengthNote(FIELD_BUDGETS.decisionDomain, FIELD_LIMITS.decisionDomain) },
                        situation: { type: 'string', description: 'The situation or state the experience was learned in.' + scalarLengthNote(FIELD_BUDGETS.situation, FIELD_LIMITS.situation) },
                        trigger: { type: 'string', description: 'The recognizable future signal that should make this experience worth recalling.' + scalarLengthNote(FIELD_BUDGETS.trigger, FIELD_LIMITS.trigger) },
                        principle: { type: 'string', description: 'The reusable rule, causal relation or judgement principle.' + scalarLengthNote(FIELD_BUDGETS.principle, FIELD_LIMITS.principle) },
                        recommended_action: { type: 'string', description: 'The future action the principle turns into.' + scalarLengthNote(FIELD_BUDGETS.recommendedAction, FIELD_LIMITS.recommendedAction) },
                        exclusions: { type: 'array', items: { type: 'string' }, description: 'Conditions under which this experience must not be transferred.' + listLengthNote(FIELD_BUDGETS.arrayLength, FIELD_BUDGETS.arrayElement, FIELD_LIMITS.arrayLength, FIELD_LIMITS.arrayElement) },
                        evidence: { type: 'array', items: { type: 'string' }, description: 'Key facts that support the experience (not a run log).' + listLengthNote(FIELD_BUDGETS.arrayLength, FIELD_BUDGETS.arrayElement, FIELD_LIMITS.arrayLength, FIELD_LIMITS.arrayElement) },
                    },
                },
            },
            type: {
                type: 'string',
                enum: ['agent', 'team', 'orchestrator'],
                required: true,
                description: 'Subject type of the experience: "agent" for an execution subject (including child agents), "team" for a collaboration group, "orchestrator" for the orchestrating parent. A child agent may only pass "agent".',
            },
        },
        output: {
            // additionalProperties: true：宿主按 output.schema 校验返回体，而本工具是双态返回
            // （initialized / submitted）；闭合声明会把成功调用变成宿主校验错误。
            schema: {
                type: 'object',
                additionalProperties: true,
                description: 'kind="initialized": promptId / promptVersion / name / prompt / experienceType (the active generation prompt for that subject type). kind="submitted": inserted ([{id, experienceType}]) plus skipped ([{reason}]) for candidates the duplicate gate refused.',
            },
            render: textRender,
        },
        async execute(args, exec) {
            const caller = experienceCallerOf(exec);
            if (!caller.sessionId)
                throw new WfError('无法识别调用者会话，无法确定经验归属的主体', 'WF_BAD_CALLER');
            const type = parseExperienceType(args?.type);
            assertExperienceTypeOwnership(caller, type);
            const raw = args?.experiences;
            if (!Array.isArray(raw)) {
                throw new WfError('experiences 必须是候选数组：要取得生成 Prompt 请传空数组；本次没有值得长期保留的经验时不要调用本工具', ERR_EXPERIENCE_BAD_ARGS);
            }
            if (raw.length === 0) {
                const { prompt } = await host.experience.initializePrompt({ caller, type });
                return {
                    kind: 'initialized',
                    promptId: prompt.id,
                    promptVersion: prompt.promptVersion,
                    name: prompt.name,
                    prompt: prompt.prompt,
                    experienceType: prompt.experienceType,
                };
            }
            // domain 的错误码原样上抛：初始化状态、协议校验与嵌入可用性都由它拥有，工具层改写
            // 消息会让同一事实两处维护。
            const { inserted, skipped } = await host.experience.submit({
                caller,
                type,
                candidates: mapExperienceCandidates(raw, type),
            });
            return {
                kind: 'submitted',
                inserted: inserted.map((entry) => ({ id: entry.id, experienceType: entry.experienceType })),
                skipped: skipped.map((item) => ({ reason: item.reason })),
            };
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