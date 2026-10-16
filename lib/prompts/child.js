// src/host/prompts/child.ts
//
// 子代理侧提示词构建器：节点任务块（每次运行注入的那一段）+ 降级通道协作块。
// 正文全部在 texts/child-node-task.ts；本文件只把事实翻译成模板变量并渲染一次。
import { flag, renderTemplate } from './render.js';
import { CHILD_COLLAB_BLOCK, CHILD_NODE_TASK } from './texts/child-node-task.js';
/** Team 内通信必须经插件自建协作工具的规则句（降级通道组内成员注入）。 */
const COLLAB_ASK_ONLY = '与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）';
/**
 * 组内通信约束（official 通道不注入：协作规则以官方 team:policy 为唯一契约源，
 * 插件再注入一条等价约束会形成第二份协作契约）。
 */
function collabRuleOf(isGroupMember, channel) {
    if (!isGroupMember)
        return '';
    return channel === 'official' ? '' : COLLAB_ASK_ONLY;
}
/** 节点任务块构建器（纯函数）：注入子代理「本轮该干什么 + 手上有什么」的完整文本。 */
export function buildNodeTaskBlock(params) {
    const { facts } = params;
    const systemLanguage = String(facts.systemLanguage ?? '').trim();
    const collabRule = collabRuleOf(facts.isGroupMember, facts.collabChannel);
    const outputContract = String(facts.outputContract ?? '').trim();
    return renderTemplate(CHILD_NODE_TASK, {
        nodeLabel: facts.nodeLabel,
        systemLanguage,
        collabRule,
        collabIndex: systemLanguage ? '2' : '1',
        upstreamEntries: facts.upstreamContext
            .map((entry) => `- ${entry.source}（id：${entry.nodeId}）：${entry.content}`)
            .join('\n'),
        noUpstream: flag(facts.upstreamContext.length === 0),
        filePathsText: (facts.filePaths ?? []).map((filePath) => `- ${filePath}`).join('\n'),
        inputContract: String(facts.inputContract ?? '').trim(),
        dbToolHint: String(facts.dbToolHint ?? '').trim(),
        outputContract,
    });
}
/** 协作成员清单块构建器（纯函数）：追加到成员首条用户消息末尾。 */
export function buildCollabBlock(params) {
    const channel = params?.channel === 'official' ? 'official' : 'legacy';
    const members = Array.isArray(params?.members) ? params.members : [];
    const membersText = members.length === 0
        ? '- （无其他成员）'
        : members
            .map((member) => {
            const id = String(member?.id ?? '');
            const label = String(member?.label ?? '').trim();
            const target = String(member?.target ?? '').trim();
            // 官方通道以成员名寻址（send_message 的 target）；自建通道以节点 id 寻址
            return channel === 'official' && target
                ? `- ${label || id}（成员名：${target}）`
                : `- ${label || id}（id：${id}）`;
        })
            .join('\n');
    return renderTemplate(CHILD_COLLAB_BLOCK, {
        membersText,
        official: flag(channel === 'official'),
        legacy: flag(channel === 'legacy'),
        custom: String(params?.custom ?? '').trim(),
    });
}
//# sourceMappingURL=child.js.map