import type { CollabChannel } from './collab.js';
/**
 * 节点任务块的入参（中文注释每个字段）。
 * `facts` 为同一 run 内字节稳定的静态事实；构建器不注入任何动态态信息，
 * 故不设 dynamic 段（动态段属编排系指令的形态，节点任务块没有此类内容）。
 */
export interface NodeTaskBlockParams {
    /** 静态事实：节点身份 / 上下文注入（同一 run 内稳定）。 */
    facts: {
        /**
         * 节点人类可读名称（身份行与中段指代）。
         */
        nodeLabel: string;
        /**
         * 上游产出上下文（全链路自动注入）：上游节点最终产出摘要/产物文本，作为下游节点的
         * 上下文注入。数组元素为「来源名称 + 来源节点 id + 内容」；可为空（无上游产出即不注入）。
         * 长文本（文档/上游产物）统一置于中段（lost-in-the-middle 处置）。
         */
        upstreamContext: Array<{
            nodeId: string;
            source: string;
            content: string;
        }>;
        /**
         * 文件路径索引：非文本文件节点连线注入的受管文件路径（data/files/），子代理经
         * 官方读取工具自行读取（不直通模型上下文）。可为空。
         */
        filePaths: string[];
        /**
         * 数据库工具说明：存在 db-in 连线时说明 wf_db_query 三模式（search/query/schema，
         * 只读）用法；无 db-in 连线时为空字符串。
         */
        dbToolHint: string;
        /**
         * Team 成员标记：该节点为 Team 成员时注入「组内通信必须走本通道」的软约束。
         */
        isGroupMember: boolean;
        /**
         * 协作通道（isGroupMember 时决定注入哪条通信约束）：
         *   - official = 官方 Agent Team 邮箱（send_message + 成员名）；
         *   - legacy = 插件自建协作工具（wf_ask_agent + 成员节点 id）。
         * 缺省 legacy：未启用官方团队时保持既有文案与行为。
         */
        collabChannel?: CollabChannel;
        /**
         * 输入契约（节点配置 data.inputSchema）：告诉该子代理「应当收到什么输入」，
         * 避免它重复索要上游已提供的信息。为空则不组装该段。
         */
        inputContract: string;
        /**
         * 输出契约（节点配置 data.outputSchema）：该子代理的最终回复必须按其组织。
         * 为空则不组装该段（= 节点不配置契约）。默认文本在新建节点时已落盘，
         * 因此这里不做任何兜底、也不与默认文本叠加（用户裁决 2026-10）。
         * 注意这是**柔性文本契约**（用户裁决 A3：不做结构校验），只影响提示词，不参与校验。
         */
        outputContract: string;
        /**
         * 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。
         * 注入「所有对话回复、注释、思考过程必须使用该语言」规则。
         */
        systemLanguage: string;
    };
}
/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
 */
export declare const NODE_HARD_CONSTRAINTS: {
    /** Team 内通信必须经插件自建协作工具（**降级通道**的组内成员注入）。 */
    readonly collabAskOnly: "与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）";
};
/**
 * 节点任务块构建器（纯函数）。
 *
 * 输出字符串同一 run 内字节稳定：首段软约束 + 中段过程性信息固定；末段重申固定，
 * 之后仅追加本次动态态信息。不读时钟、不随机。
 *
 * @param params - 模板入参（facts 静态事实 + dynamic 末段动态态信息）。
 * @returns 注入子代理的任务文本（面向模型，中文）。
 */
export declare function buildNodeTaskBlock(params: NodeTaskBlockParams): string;
