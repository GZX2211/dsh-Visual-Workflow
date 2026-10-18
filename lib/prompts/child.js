// src/host/prompts/child.ts
//
// 子代理侧提示词构建器：节点任务块（每次运行注入的那一段）。
// 正文全部在 texts/child-node-task.ts；本文件只把事实翻译成模板变量并渲染一次。
import { isEnglishSystemLanguage } from '../system-language.js';
import { localizeOutputContract } from './defaults.js';
import { flag, renderTemplate } from './render.js';
import { CHILD_NODE_TASK } from './texts/child-node-task.js';
import { CHILD_NODE_TASK_EN } from './texts/en/child-node-task.js';
/** 节点任务块构建器（纯函数）：注入子代理「本轮该干什么 + 手上有什么 + 能找谁」的完整文本。 */
export function buildNodeTaskBlock(params) {
    const { facts } = params;
    const english = isEnglishSystemLanguage(facts.systemLanguage);
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
    });
}
//# sourceMappingURL=child.js.map