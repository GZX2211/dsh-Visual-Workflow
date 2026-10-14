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
    /** Team 卡片上用户自定义的协作说明文本（可为空；空则不追加说明段）。 */
    custom: string;
    /**
     * 协作通道（成员是官方 teammate 还是普通子代理）。
     * 注意 official 分支当前**没有调用方**：官方通道不注入协作块（官方 team:policy 承担协作
     * 规则与寻址），成员清单与通信指引只在降级通道注入。该分支保留为完整模板备用。
     */
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
