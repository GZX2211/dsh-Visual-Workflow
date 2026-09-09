/** 执行单元共用的过程性信息（上游产出 / 文件路径索引 / 数据库工具说明）。 */
export interface ExecutorContextFacts {
    /** 节点人类可读名称。 */
    nodeLabel: string;
    /** 上游产出上下文（ctx 连线注入；数组元素为「来源 → 内容」键值，可为空）。 */
    upstreamContext: Array<{
        source: string;
        content: string;
    }>;
    /** 文件路径索引（data/files/ 受管路径），可为空。 */
    filePaths: string[];
    /** 数据库工具说明（db-in 连线存在时非空），可为空。 */
    dbToolHint: string;
    /** 协作组成员标记：注入组内通信必须经 wf_ask_agent 的软约束。 */
    isGroupMember: boolean;
}
/**
 * 情况2 父代理自执行单元任务块入参。
 */
export interface ParentTaskSpecParams {
    facts: ExecutorContextFacts;
    /** 本次执行单元的运行上下文说明（runId、attempt 等；可为空）。 */
    runContextText?: string;
    /** 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。 */
    systemLanguage: string;
}
/**
 * 情况3 纯执行父代理提示词入参。
 */
export interface ParentExecutorPromptParams {
    /** 工作流名称。 */
    workflowName: string;
    facts: ExecutorContextFacts;
    /** 本次执行的运行上下文说明（runId、attempt 等；仅注入末段动态态）。 */
    runContextText: string;
    /** 系统语言名（如 '中文' / 'English'；从 DSH 用户设置读取）。 */
    systemLanguage: string;
}
/** 执行收尾协议短语（情况3 首段 + 末段重申双位；W-02）。 */
export declare const EXECUTOR_FINISH_RULE = "\u5B8C\u6210\u8282\u70B9\u4EFB\u52A1\u540E\uFF0C\u8C03\u7528 wf_finish \u7ED3\u675F\u672C\u6B21\u8FD0\u884C\uFF08\u53EA\u8C03\u7528\u4E00\u6B21\uFF0C\u5E42\u7B49\uFF09";
/**
 * 情况2 父代理自执行单元任务块（编排指令末段小节正文；纯函数）。
 * 不含「# 硬性约束」等块级标题（避免与编排指令嵌套冲突），只列过程性信息与运行上下文。
 */
export declare function buildParentTaskSpec(params: ParentTaskSpecParams): string;
/**
 * 情况3 纯执行父代理提示词构建器（纯函数）：
 * 首段身份 + 执行约定 + 收尾协议；中段过程性信息；末段重申 + 运行上下文动态态。
 * 不含任何编排/流程调度措辞（事实源、待编排节点、协作组并行、调用协议等一律剔除）。
 */
export declare function buildParentExecutorPrompt(params: ParentExecutorPromptParams): string;
