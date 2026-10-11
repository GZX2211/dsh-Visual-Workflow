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
import { EXPERIENCE_TYPES, FIELD_BUDGETS } from '../../experience/index.js';
import { ERR_EXPERIENCE_BAD_ARGS, WF_EXPERIENCE_LEARN } from '../../shared/protocol.js';
import { WfError } from '../../orchestrator/index.js';
import { experienceCallerOf } from '../infrastructure/caller.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { EXPERIENCE_TYPE_PARAM_DESCRIPTION, assertExperienceTypeOwnership, parseExperienceType } from '../infrastructure/experience-contract.js';
import { textRender } from '../infrastructure/text-render.js';
import { mapExperienceCandidates } from './apply.js';
/**
 * 标量字段的长度提示：只给生成预算。
 * 硬上限不进模型可见面（用户裁决）：预算已把写作压在安全区内，上限只是运行期校验的护栏，
 * 让模型知道它没有决策价值。数字取自经验域唯一本体；措辞属工具层——模型必须读成「引导」而不是「校验」。
 */
function scalarLengthNote(budget) {
    return ` Aim for at most ${budget} characters.`;
}
/** 数组字段的长度提示：条数与单条长度的生成预算（同样不暴露硬上限）。 */
function listLengthNote(items, element) {
    return ` At most ${items} items, each aimed at ${element} characters.`;
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
        description: 'Learn the durable experiences from a finished unit of work, or fetch the generation prompt that tells you what to learn. Pass an empty experiences array to get the active Experience Generation Prompt for your current subject type, then pass candidate experiences to store them. Each candidate carries the nine semantic fields below; unknown fields are rejected, not dropped. '
            + `Those length budgets are prompt guidance, not a validation rule, so a slight overrun is still accepted. Keep the nine fields of one candidate within about ${FIELD_BUDGETS.total} characters in total. `
            + 'Preconditions: the prompt for the same type must be fetched in this run before any candidate is accepted, otherwise the call fails with WF_EXPERIENCE_NOT_INITIALIZED and you must fetch the prompt first. A generation prompt is shared by every subject of its type, so fetching it again is safe and idempotent. '
            + 'Failure semantics: a child agent may only pass type "agent" (WF_EXPERIENCE_WRONG_TYPE); a candidate that breaks the protocol fails the whole call with WF_EXPERIENCE_VALIDATION; malformed arguments fail with WF_EXPERIENCE_BAD_ARGS; when semantic embedding is unavailable nothing is written and the call fails with WF_EXPERIENCE_EMBEDDING_UNAVAILABLE. '
            + 'Side effects: a successful submission writes the accepted candidates into the shared experience library; near-duplicate experiences are skipped and reported in skipped with the reason instead of being stored twice. '
            + 'If this unit of work produced nothing worth keeping for the long term, do not submit anything: skip the learning step and end your turn.',
        parameters: {
            experiences: {
                type: 'array',
                required: true,
                description: 'Candidate experiences to store, or an empty array to fetch the generation prompt instead of storing anything. Each candidate carries the nine semantic fields the prompt asks for; unknown fields are rejected by validation, not dropped.',
                items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        responsibility: { type: 'string', description: 'What the subject is responsible for in this unit of work.' + scalarLengthNote(FIELD_BUDGETS.responsibility) },
                        task_type: { type: 'string', description: 'Coarse task category label used for retrieval, not the concrete task name.' + scalarLengthNote(FIELD_BUDGETS.taskType) },
                        decision_domain: { type: 'string', description: 'The class of decision this experience is about.' + scalarLengthNote(FIELD_BUDGETS.decisionDomain) },
                        situation: { type: 'string', description: 'The situation or state the experience was learned in.' + scalarLengthNote(FIELD_BUDGETS.situation) },
                        trigger: { type: 'string', description: 'The recognizable future signal that should make this experience worth recalling.' + scalarLengthNote(FIELD_BUDGETS.trigger) },
                        principle: { type: 'string', description: 'The reusable rule, causal relation or judgement principle.' + scalarLengthNote(FIELD_BUDGETS.principle) },
                        recommended_action: { type: 'string', description: 'The future action the principle turns into.' + scalarLengthNote(FIELD_BUDGETS.recommendedAction) },
                        exclusions: { type: 'array', items: { type: 'string' }, description: 'Conditions under which this experience must not be transferred.' + listLengthNote(FIELD_BUDGETS.arrayLength, FIELD_BUDGETS.arrayElement) },
                        evidence: { type: 'array', items: { type: 'string' }, description: 'Key facts that support the experience (not a run log).' + listLengthNote(FIELD_BUDGETS.arrayLength, FIELD_BUDGETS.arrayElement) },
                    },
                },
            },
            type: {
                type: 'string',
                // 取值域与域层同源（类型联合 / constants 表 / 工具 enum 三处一处本体）
                enum: [...EXPERIENCE_TYPES],
                required: true,
                description: EXPERIENCE_TYPE_PARAM_DESCRIPTION,
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
                throw new WfError('WF_BAD_CALLER: cannot identify the caller session, so the experience subject cannot be resolved', 'WF_BAD_CALLER');
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