// src/host/prompts/collab.ts
//
// 协作成员清单块构建器（T-005 基线之一，需求变更后重写）。
//
// 背景：此前把「协作 Prompt」作为 `collab:` 段追加到组内成员 System Prompt 末尾。
//       需求变更：协作信息**改为追加到成员的用户消息**（首条任务块），且**无论
//       用户写了什么（即使空白）都默认追加组内所有成员的 ID + 角色名称清单**，
//       用于告知成员「你在和谁协作、能向谁发送协作消息（wf_ask_agent）」。
//
// 纯函数：输入 members/custom 不变则输出字节不变。
import { isEnglishSystemLanguage } from '../system-language.js';
import { buildEnglishCollab } from './english.js';
/**
 * 协作成员清单块构建器（纯函数）。
 *
 * 输出为追加到成员首条用户消息的协作块：先列出本组全部成员（名称 + 可寻址标识），
 * 再追加用户自定义协作说明（若有），最后给出本通道的通信工具。始终包含成员清单，
 * 与 custom 是否为空无关。
 *
 * @param params - 成员清单 + 自定义协作说明 + 通道。
 * @returns 追加到成员用户消息的协作块（面向模型，中文）。
 */
export function buildCollabBlock(params) {
    if (isEnglishSystemLanguage(params.systemLanguage))
        return buildEnglishCollab(params);
    const channel = params?.channel === 'official' ? 'official' : 'legacy';
    const lines = [
        '你是协作组的成员。本组成员为：',
    ];
    const members = Array.isArray(params?.members) ? params.members : [];
    if (members.length === 0) {
        lines.push('- （无其他成员）');
    }
    else {
        for (const member of members) {
            const id = String(member?.id ?? '');
            const label = String(member?.label ?? '').trim();
            const target = String(member?.target ?? '').trim();
            // 官方通道以成员名寻址（send_message 的 target）；自建通道以节点 id 寻址
            lines.push(channel === 'official' && target
                ? `- ${label || id}（成员名：${target}）`
                : `- ${label || id}（id：${id}）`);
        }
    }
    lines.push(channel === 'official'
        ? '与其他成员通信时，请使用 send_message 工具，target 填对方的成员名；需要 Lead 决策或汇总时 target 填 "lead"。'
        : '与其他成员通信时，请使用 wf_ask_agent 工具，并将 targetChildId 填为对方成员 id。');
    const custom = String(params?.custom ?? '').trim();
    if (custom) {
        lines.push('', '组内说明：', custom);
    }
    return lines.join('\n');
}
//# sourceMappingURL=collab.js.map