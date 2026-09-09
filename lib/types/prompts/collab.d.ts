/**
 * 协作成员清单块入参（中文注释每个字段）。
 */
export interface CollabBlockParams {
    /** 成员清单：组内每个角色节点的 id + 人类可读名称（始终注入，即使 custom 为空）。 */
    members: Array<{
        id: string;
        label: string;
    }>;
    /** 组卡片上用户自定义的协作说明文本（可为空；空则不追加说明段）。 */
    custom: string;
}
/**
 * 协作成员清单块构建器（纯函数）。
 *
 * 输出为追加到成员首条用户消息的协作块：先列出本组全部成员（id + 角色名，告知协作对象），
 * 再追加用户自定义协作说明（若有）。始终包含成员清单，与 custom 是否为空无关。
 *
 * @param params - 成员清单 + 自定义协作说明。
 * @returns 追加到成员用户消息的协作块（面向模型，中文；含成员 ID + 角色名清单）。
 */
export declare function buildCollabBlock(params: CollabBlockParams): string;
