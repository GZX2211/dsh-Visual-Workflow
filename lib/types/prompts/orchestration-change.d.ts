/** 编排变更通知标题标记（父代理与单测据此识别消息性质）。 */
export declare const ORCH_CHANGE_MARKER = "\u3010\u7F16\u6392\u53D8\u66F4\u3011";
/** 编排变更通知入参（全部为静态事实，构建结果字节稳定）。 */
export interface OrchestrationChangeParams {
    /** 工作流名称（人类可读标题）。 */
    workflowName: string;
    /** 运行事实源文件路径（orchestrations/<runId>.json；父代理需重读的只读 JSON）。 */
    definitionPath: string;
    /** 系统语言名（如 '中文'；从 DSH 用户设置读取，缺省不注入语言规则）。 */
    systemLanguage?: string;
}
/**
 * 组装「编排变更」通知文本（纯函数）。
 * 通知本身不是新任务：只要求父代理重读最新事实源并按新拓扑调整后续调度。
 */
export declare function buildOrchestrationChangeText(params: OrchestrationChangeParams): string;
