/**
 * 协作成员清单块入参（中文注释每个字段）。
 */
export interface CollabBlockParams {
    /** 成员清单：组内每个角色节点的 id + 人类可读名称（始终注入，即使 custom 为空）。 */
    members: Array<{
        id: string;
        label: string;
        target?: string;
    }>;
    /** 组卡片上用户自定义的协作说明文本（可为空；空则不追加说明段）。 */
    custom: string;
    /**
     * 协作通道：告诉成员「用什么工具、填什么标识」与队友通信。
     *   - official = 官方 Agent Team 邮箱（send_message，target 为成员名）；
     *   - legacy = 插件自建协作工具（wf_ask_agent，targetChildId 为成员节点 id）。
     * 缺省 legacy：未启用官方团队时保持既有文案与行为。
     */
    systemLanguage?: string;
    channel?: CollabChannel;
}
/** 协作通道类型（官方团队 / 插件自建）。 */
export type CollabChannel = 'official' | 'legacy';
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
export declare function buildCollabBlock(params: CollabBlockParams): string;
