// src/host/prompts/planner.ts
//
// 规划期父代理提示词构建器（/arrange 注入；正文在 texts/parent-planner.ts）。
// 三种目标只差 identity / goal / grammar 三个变量。
import { isEnglishSystemLanguage } from '../system-language.js';
import { renderTemplate } from './render.js';
import { PARENT_PLANNER } from './texts/parent-planner.js';
import { PARENT_PLANNER_EN } from './texts/en/parent-planner.js';
/** 改图语法指引（首段第 1 条与末段重申共用同一措辞）。 */
const CREATE_TEMPLATE_GRAMMAR = "新建模板：提交 scope='template' 且带 create={name, description?, mode?} 的补丁，工具返回的 targetId 即新模板 id";
const UPDATE_TARGET_GRAMMAR = "改既有目标：scope='template' 改模板、scope='instance' 改实例，且必须带 targetId 与 expectRevision";
const CREATE_TEMPLATE_GRAMMAR_EN = "Create a template: submit a patch with scope='template' and create={name, description?, mode?}; the targetId returned by the tool is the new template id";
const UPDATE_TARGET_GRAMMAR_EN = "Edit an existing target: use scope='template' for a template or scope='instance' for an instance, and include targetId and expectRevision";
/** 目标描述（首段身份行 + 中段目标行 + 语法指引共用，避免三处措辞漂移）。 */
function describeTarget(facts, english) {
    const id = String(facts.targetId ?? '').trim();
    const requestedName = String(facts.targetName ?? '').trim();
    const name = requestedName || id || (english ? 'new workflow template' : '新工作流模板');
    const idText = id || (english ? '(unspecified)' : '（未指定）');
    if (facts.target === 'template') {
        return english
            ? {
                identity: `You are the organization planner for workflow template "${name}" (id=${idText}).`,
                goal: `Planning target template: ${name} (id=${idText}). The plan is saved as a template snapshot first; the user decides whether to deploy it.`,
                grammar: UPDATE_TARGET_GRAMMAR_EN,
            }
            : {
                identity: '你是工作流模板「' + name + '」（id=' + idText + '）的组织规划师。',
                goal: '规划目标模板：' + name + '（id=' + idText + '）。规划产物先落盘为模板快照，再由用户决定是否投产。',
                grammar: UPDATE_TARGET_GRAMMAR,
            };
    }
    if (facts.target === 'instance') {
        return english
            ? {
                identity: `You are the orchestration planner for workflow instance "${name}" (id=${idText}).`,
                goal: `Planning target instance: ${name} (id=${idText}). Edits to an instance immediately sync to its running orchestration and the canvas.`,
                grammar: UPDATE_TARGET_GRAMMAR_EN,
            }
            : {
                identity: '你是工作流实例「' + name + '」（id=' + idText + '）的编排规划师。',
                goal: '规划目标实例：' + name + '（id=' + idText + '）。对实例的编排改写会即时同步到运行中的编排与画布回显。',
                grammar: UPDATE_TARGET_GRAMMAR,
            };
    }
    return english
        ? {
            identity: "You are the workflow organization planner: plan and create a new workflow template from the user's intent.",
            goal: `Planning target: new workflow template${requestedName ? ` "${requestedName}"` : ''} (the template id is generated and returned by wf_graph_patch's create path).`,
            grammar: CREATE_TEMPLATE_GRAMMAR_EN,
        }
        : {
            identity: '你是工作流的组织规划师：请按用户意图规划并新建一个工作流模板。',
            goal: '规划目标：新建工作流模板' + (requestedName ? '「' + requestedName + '」' : '')
                + '（模板 id 由 wf_graph_patch 的 create 通路生成并返回）。',
            grammar: CREATE_TEMPLATE_GRAMMAR,
        };
}
/** 构建规划期父代理提示词（纯函数）。 */
export function buildOrgPlanPrompt(params) {
    const { facts, dynamic } = params;
    const english = isEnglishSystemLanguage(facts.systemLanguage);
    const target = describeTarget(facts, english);
    const intent = String(dynamic.userIntent ?? '').trim();
    return renderTemplate(english ? PARENT_PLANNER_EN : PARENT_PLANNER, {
        identity: target.identity,
        goal: target.goal,
        grammar: target.grammar,
        systemLanguage: String(facts.systemLanguage ?? '').trim(),
        userIntent: intent || (english ? '(not provided; clarify the goal with the user first)' : '（未提供，请先与用户确认目标后再动手）'),
        userSop: String(dynamic.userSop ?? '').trim(),
    });
}
//# sourceMappingURL=planner.js.map