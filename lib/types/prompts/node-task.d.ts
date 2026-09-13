/**
 * 节点任务块的入参（中文注释每个字段）。
 * `facts` 为同一 run 内字节稳定的静态事实；`dynamic` 字段保留（向前兼容调用方），
 * 构建器当前不注入任何动态态信息。
 */
export interface NodeTaskBlockParams {
    /** 静态事实：节点身份 / 任务 / 上下文注入（同一 run 内稳定）。 */
    facts: {
        /**
         * 节点任务文本：节点自身的 System Prompt（persona），即子代理要完成的子任务。
         * 任务正文经 prompt-setup 作为系统提示词段注入，本任务块不再重复正文。
         */
        task: string;
        /**
         * 节点人类可读名称（身份行与中段指代）。
         */
        nodeLabel: string;
        /**
         * 上游产出上下文（ctx 连线注入）：上游节点最终产出摘要/产物文本，作为下游节点的
         * 上下文注入。数组元素为「来源 → 内容」键值；可为空（无 ctx 连线即不注入）。
         * 长文本（文档/上游产物）统一置于中段（lost-in-the-middle 处置）。
         */
        upstreamContext: Array<{
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
         * 协作组成员标记：该节点为协作组成员时注入「组内通信必须经 wf_ask_agent」软约束。
         */
        isGroupMember: boolean;
        /**
         * 输入结构说明（节点配置 data.inputSchema）：告诉该子代理「应当收到什么输入」，
         * 避免它重复索要上游已提供的信息。为空则不组装该段。
         */
        inputContract: string;
        /**
         * 交接契约（节点配置 data.outputSchema，或系统的默认结构）：该子代理的最终回复
         * 会被下游 ctx 连线节点**直接读取**，故须按此结构组织。为空则不组装该段。
         * 注意这是**柔性文本契约**（用户裁决 A3：不做结构校验），只影响提示词，不参与校验。
         */
        outputContract: string;
        /**
         * 交接契约是否来自系统默认结构（节点未配置 outputSchema，且该节点存在 ctx-out 出线）。
         * true 时声明中提到「本结构由系统默认给出」，便于模型区分用户定制与默认。
         */
        outputContractDefaulted: boolean;
        /**
         * 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。
         * 注入「所有对话回复、注释、思考过程必须使用该语言」规则。
         */
        systemLanguage: string;
    };
    /** 动态态信息（当前未注入任务块；字段保留以兼容既有调用方）。全部可选，缺省即默认值。 */
    dynamic: {
        /**
         * 父代理会话 id（根 Agent 的会话 id；子代理的父 agent id）。
         */
        parentAgentId?: string;
    };
}
/**
 * 节点任务块首段软约束短语（W-02 双位测试断言与组装任务引用）。
 * 面向模型中文（W-04）；只保留「软约束固化」类条目（AI 有选择权、值得强调的行为规则）。
 */
export declare const NODE_HARD_CONSTRAINTS: {
    /** 协作组内通信必须经 wf_ask_agent（仅组内成员注入）。 */
    readonly collabAskOnly: "与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）";
};
/**
 * 默认交接契约的字段清单（系统兜底用；用户裁决：有 ctx-out 出线且未配置 outputSchema 时注入）。
 * 为什么是这四项：下游节点经 ctx 连线读到的就是本节点的**最终回复文本**，
 * 它需要能据此判断「结论是什么、产物在哪、有哪些已定决策、还剩什么没定」——
 * 大产物本身一律落盘（写在路径里），不靠回复正文传递。
 */
export declare const DEFAULT_OUTPUT_CONTRACT = "\u7ED3\u8BBA / \u4EA7\u51FA\u6587\u4EF6\u8DEF\u5F84 / \u5173\u952E\u51B3\u7B56 / \u672A\u51B3\u95EE\u9898";
/**
 * 交接契约声明句（首段与末段复用同一措辞源；术语一致性由本常量保证）。
 * @param defaulted true = 这段结构是系统默认给出的（节点未配置），可用但可自行细化
 */
export declare function outputContractRule(defaulted: boolean): string;
/**
 * 系统语言规则短语（面向模型中文；各提示词构建器共用）。
 * 从 DSH 用户设置读取语言名，注入「所有对话回复、注释、思考过程必须使用该语言」。
 */
export declare function systemLanguageRule(language: string): string;
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
