/** 协作通道类型（官方团队 / 插件自建）。 */
export type CollabChannel = 'official' | 'legacy';
/** 节点任务块的入参（facts 为同一 run 内字节稳定的静态事实）。 */
export interface NodeTaskBlockParams {
    facts: {
        /** 节点人类可读名称（身份行与中段指代）。 */
        nodeLabel: string;
        /** 上游产出上下文（全链路自动注入），可为空。 */
        upstreamContext: Array<{
            nodeId: string;
            source: string;
            content: string;
        }>;
        /** 文件路径索引（data/files/ 受管路径），可为空。 */
        filePaths: string[];
        /** 数据库工具说明（存在 db-in 连线时说明 wf_db_query 三模式），无则空字符串。 */
        dbToolHint: string;
        /** Team 成员标记。 */
        isGroupMember: boolean;
        /** 协作通道（isGroupMember 时决定注入哪条通信约束）；缺省 legacy。 */
        collabChannel?: CollabChannel;
        /** 输入契约（节点配置 data.inputSchema）；为空则不组装该段。 */
        inputContract: string;
        /** 输出契约（节点配置 data.outputSchema）；为空则不组装该段。 */
        outputContract: string;
        /** 系统语言名（如 '中文' / 'English'）。 */
        systemLanguage: string;
    };
}
/** 协作成员清单块入参。 */
export interface CollabBlockParams {
    /** 成员清单：组内每个角色节点的 id + 人类可读名称。 */
    members: Array<{
        id: string;
        label: string;
        target?: string;
    }>;
    /** Team 卡片上用户自定义的协作说明文本（可为空）。 */
    custom: string;
    /** 协作通道（official 分支当前无调用方，保留为完整模板备用）。 */
    channel?: CollabChannel;
}
/** 节点任务块构建器（纯函数）：注入子代理「本轮该干什么 + 手上有什么」的完整文本。 */
export declare function buildNodeTaskBlock(params: NodeTaskBlockParams): string;
/** 协作成员清单块构建器（纯函数）：追加到成员首条用户消息末尾。 */
export declare function buildCollabBlock(params: CollabBlockParams): string;
