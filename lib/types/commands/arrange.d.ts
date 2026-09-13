/** 命令名（用户裁决：英文命名，不用中文）。 */
export declare const ARRANGE_COMMAND_NAME = "arrange";
/** 命令用法提示（空意图时直接返回，不消耗一次模型回合）。 */
export declare const ARRANGE_USAGE = "\u7528\u6CD5\uFF1A/arrange <\u89C4\u5212\u610F\u56FE>\uFF08\u4F8B\u5982\uFF1A/arrange \u505A\u4E00\u4E2A\u5185\u5BB9\u751F\u4EA7\u6D41\u6C34\u7EBF\uFF0C\u542B\u9009\u9898\u3001\u6210\u7A3F\u3001\u53D1\u5E03\u4E09\u4E2A\u9636\u6BB5\uFF09";
/** 注入消息（官方 Message 契约：id + source 必填，否则父回合失败——旧项目复盘结论）。 */
export interface ArrangeInjectedMessage {
    id: string;
    role: 'user';
    content: Array<{
        type: 'text';
        text: string;
    }>;
    source: {
        kind: 'user';
    };
}
/** 命令调用上下文（官方 CommandInvocation 的最小结构子集；运行时守卫）。 */
export interface ArrangeInvocation {
    /** 接收方 agent（根会话 agent；followup 即投递一条用户消息）。 */
    agent?: {
        id?: unknown;
        followup?: (message: ArrangeInjectedMessage) => void;
    };
    /** 命令名之后的原始输入（含分隔空白）。 */
    rawInput?: unknown;
}
/** 命令结果（官方 CommandResult 子集）。 */
export type ArrangeCommandResult = {
    kind: 'success';
    text: string;
} | {
    kind: 'error';
    text: string;
};
/** commands 服务最小形状（官方 ctx.commands 子集）。 */
export interface CommandsServiceLike {
    register(definition: {
        name: string;
        description: string;
        input?: {
            hint: string;
            attachments?: boolean;
        };
        handler: (invocation: ArrangeInvocation) => ArrangeCommandResult | Promise<ArrangeCommandResult>;
    }): () => void;
}
/** 命令装配依赖（可注入缝，便于单测给确定性 id 与语言）。 */
export interface ArrangeCommandDeps {
    /** 系统语言名提供者（读 DSH 用户设置；缺省空串 = 不注入语言规则）。 */
    systemLanguage?: () => string;
    /** 注入消息 id 生成缝（单测用确定性 id）。 */
    newMessageId?: () => string;
    /** 日志缝（注销失败告警；缺省静默）。 */
    logger?: {
        warn(message: string): void;
    };
}
/**
 * 构建 `/arrange` 注入的规划提示词（纯函数）。
 * 目标固定为 create（新建模板）；既有目标的更新语义由提示词内的语法指引覆盖。
 */
export declare function buildArrangePrompt(input: {
    userIntent: string;
    systemLanguage?: string;
}): string;
/** 命令失败文案：接收 Agent 未激活。 */
export declare const ARRANGE_NO_AGENT = "\u5F53\u524D\u4F1A\u8BDD\u4E0D\u53EF\u7528\u4E8E\u7F16\u6392\u89C4\u5212\uFF08\u63A5\u6536 Agent \u672A\u6FC0\u6D3B\uFF09\u3002";
/** 命令成功后的 UI 直出文案（不进入模型上下文）。 */
export declare const ARRANGE_ACCEPTED_TEXT: string;
/**
 * 注册 `/arrange` 命令（全局层；命令面缺失时静默跳过）。
 * @returns disposer：注销命令注册（命令面缺失时为 no-op）。
 */
export declare function registerArrangeCommand(ctx: {
    get(name: string): unknown;
}, deps?: ArrangeCommandDeps): () => void;
