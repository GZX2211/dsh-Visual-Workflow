// src/host/prompts/parents.ts
//
// 父代理提示词构建器（情况1 纯编排 / 情况2 编排+自执行 / 情况3 纯执行 + 情况2 末段任务块）。
//
// 组装方式：正文全部在 texts/parent-*.ts；本文件只把事实翻译成模板变量并渲染一次。
// 模板变量命名与 texts/ 文件头的「变量」注释一一对应。
import { flag, renderTemplate } from './render.js';
import { PARENT_ORCHESTRATOR } from './texts/parent-orchestrator.js';
import { PARENT_HYBRID } from './texts/parent-hybrid.js';
import { PARENT_EXECUTOR, PARENT_TASK_SPEC } from './texts/parent-executor.js';
/** 上游产出行（多行文本；无上游时返回空串，由模板输出「（无）」）。 */
function upstreamLinesOf(entries) {
    return entries.map((entry) => `- ${entry.source}（id：${entry.nodeId}）：${entry.content}`).join('\n');
}
/** 文件路径索引行（多行文本）。 */
function fileLinesOf(filePaths) {
    return filePaths.map((filePath) => `- ${filePath}`).join('\n');
}
/** 执行单元上下文变量（情况2 任务块与情况3 提示词共用同一口径）。 */
function executorContextVars(facts) {
    return {
        nodeLabel: facts.nodeLabel,
        upstreamEntries: upstreamLinesOf(facts.upstreamContext),
        noUpstream: flag(facts.upstreamContext.length === 0),
        filePathsText: fileLinesOf(facts.filePaths),
        dbToolHint: String(facts.dbToolHint ?? '').trim(),
    };
}
/** Team 段变量（无 Team 卡片时不出现该段）。 */
function teamVarsOf(facts) {
    const groups = facts.collabGroups ?? [];
    const official = facts.collabChannel === 'official';
    return {
        teamGroups: groups
            .map((group) => `- ${group.groupId}（${group.label}）：成员节点 [${group.memberIds.join(', ')}]`)
            .join('\n'),
        teamChannelLabel: official ? '官方团队' : '降级通道',
        teamOfficial: flag(official),
        teamLegacy: flag(!official),
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
    return renderTemplate(PARENT_ORCHESTRATOR, {
        workflowName: facts.workflowName,
        systemLanguage: String(facts.systemLanguage ?? '').trim(),
        workflowGoal: String(facts.workflowGoal ?? '').trim(),
        ...teamVarsOf(facts),
        ...dynamicVarsOf(dynamic),
    });
}
/** 情况2（编排 + 自执行）父代理提示词构建器（纯函数）。 */
export function buildHybridPrompt(params) {
    const { facts, dynamic } = params;
    const parent = facts.parentNode;
    return renderTemplate(PARENT_HYBRID, {
        workflowName: facts.workflowName,
        parentNodeLabel: parent ? parent.nodeLabel : '',
        parentNodeId: parent ? parent.nodeId : '',
        systemLanguage: String(facts.systemLanguage ?? '').trim(),
        workflowGoal: String(facts.workflowGoal ?? '').trim(),
        ...teamVarsOf(facts),
        ...dynamicVarsOf(dynamic),
    });
}
/**
 * 情况2 父代理自执行单元任务块（编排指令末段小节正文；纯函数）。
 * 只列过程性信息与运行上下文，不含块级标题（避免与编排指令嵌套冲突）。
 */
export function buildParentTaskSpec(params) {
    const { facts, runContextText } = params;
    return renderTemplate(PARENT_TASK_SPEC, {
        ...executorContextVars(facts),
        runContextText: String(runContextText ?? '').trim(),
    });
}
/** 情况3 纯执行父代理提示词构建器（纯函数）。 */
export function buildParentExecutorPrompt(params) {
    const { workflowName, facts, runContextText, systemLanguage } = params;
    return renderTemplate(PARENT_EXECUTOR, {
        workflowName,
        systemLanguage: String(systemLanguage ?? '').trim(),
        isGroupMember: flag(facts.isGroupMember),
        runContextText: String(runContextText ?? '').trim() || '（无）',
        ...executorContextVars(facts),
    });
}
//# sourceMappingURL=parents.js.map