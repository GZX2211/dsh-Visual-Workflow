// src/host/prompts/parents.ts
//
// 父代理提示词构建器（情况1 纯编排 / 情况2 编排+自执行 / 情况3 纯执行 + 情况2 末段任务块）。
//
// 组装方式：正文全部在 texts/parent-*.ts；本文件只把事实翻译成模板变量并渲染一次。
// 模板变量命名与 texts/ 文件头的「变量」注释一一对应。
import { isEnglishSystemLanguage } from '../system-language.js';
import { flag, renderTemplate } from './render.js';
import { PARENT_ORCHESTRATOR } from './texts/parent-orchestrator.js';
import { PARENT_HYBRID } from './texts/parent-hybrid.js';
import { PARENT_EXECUTOR, PARENT_TASK_SPEC } from './texts/parent-executor.js';
import { PARENT_ORCHESTRATOR_EN } from './texts/en/parent-orchestrator.js';
import { PARENT_HYBRID_EN } from './texts/en/parent-hybrid.js';
import { PARENT_EXECUTOR_EN, PARENT_TASK_SPEC_EN } from './texts/en/parent-executor.js';
/** 上游产出行（多行文本；无上游时返回空串，由模板输出「（无）」/ "(none)"）。 */
function upstreamLinesOf(entries, english) {
    return entries
        .map((entry) => english
        ? `- ${entry.source} (id: ${entry.nodeId}): ${entry.content}`
        : `- ${entry.source}（id：${entry.nodeId}）：${entry.content}`)
        .join('\n');
}
/** 执行单元上下文变量（情况2 任务块与情况3 提示词共用同一口径）。 */
function executorContextVars(facts, english) {
    return {
        nodeLabel: facts.nodeLabel,
        upstreamEntries: upstreamLinesOf(facts.upstreamContext, english),
        noUpstream: flag(facts.upstreamContext.length === 0),
        dbToolHint: String(facts.dbToolHint ?? '').trim(),
    };
}
/** Team 段变量（无 Team 卡片时不出现该段）。 */
function teamVarsOf(facts, english) {
    return {
        teamGroups: (facts.collabGroups ?? [])
            .map((group) => english
            ? `- ${group.groupId} (${group.label}): member nodes [${group.memberIds.join(', ')}]`
            : `- ${group.groupId}（${group.label}）：成员节点 [${group.memberIds.join(', ')}]`)
            .join('\n'),
    };
}
/** 运行期任务输入变量（情况1/2 共用）：用户问题与父代理自执行任务块。 */
function dynamicVarsOf(dynamic) {
    return {
        question: String(dynamic.question ?? '').trim(),
        parentTaskBlock: String(dynamic.parentTaskBlock ?? '').trim(),
    };
}
/** 情况1（纯编排）父代理提示词构建器（纯函数）。 */
export function buildOrchestratorPrompt(params) {
    const { facts, dynamic } = params;
    const english = isEnglishSystemLanguage(facts.systemLanguage);
    return renderTemplate(english ? PARENT_ORCHESTRATOR_EN : PARENT_ORCHESTRATOR, {
        workflowName: facts.workflowName,
        systemLanguage: String(facts.systemLanguage ?? '').trim(),
        workflowGoal: String(facts.workflowGoal ?? '').trim(),
        ...teamVarsOf(facts, english),
        ...dynamicVarsOf(dynamic),
    });
}
/** 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。 */
export function buildHybridPrompt(params) {
    const { facts, dynamic } = params;
    const parent = facts.parentNode;
    const english = isEnglishSystemLanguage(facts.systemLanguage);
    return renderTemplate(english ? PARENT_HYBRID_EN : PARENT_HYBRID, {
        workflowName: facts.workflowName,
        parentNodeLabel: parent ? parent.nodeLabel : '',
        parentNodeId: parent ? parent.nodeId : '',
        systemLanguage: String(facts.systemLanguage ?? '').trim(),
        workflowGoal: String(facts.workflowGoal ?? '').trim(),
        ...teamVarsOf(facts, english),
        ...dynamicVarsOf(dynamic),
    });
}
/**
 * 情况2 父代理自执行单元任务块（编排指令末段小节正文；纯函数）。
 * 只列过程性信息与运行上下文，不含块级标题（避免与编排指令嵌套冲突）。
 */
export function buildParentTaskSpec(params) {
    const { facts, runContextText } = params;
    const english = isEnglishSystemLanguage(params.systemLanguage);
    return renderTemplate(english ? PARENT_TASK_SPEC_EN : PARENT_TASK_SPEC, {
        ...executorContextVars(facts, english),
        runContextText: String(runContextText ?? '').trim(),
    });
}
/** 情况3 纯执行父代理提示词构建器（纯函数）。 */
export function buildParentExecutorPrompt(params) {
    const { workflowName, facts, runContextText, systemLanguage } = params;
    const english = isEnglishSystemLanguage(systemLanguage);
    return renderTemplate(english ? PARENT_EXECUTOR_EN : PARENT_EXECUTOR, {
        workflowName,
        systemLanguage: String(systemLanguage ?? '').trim(),
        runContextText: String(runContextText ?? '').trim() || (english ? '(none)' : '（无）'),
        ...executorContextVars(facts, english),
    });
}
//# sourceMappingURL=parents.js.map