/**
 * 系统语言规则短语（面向模型中文；各提示词构建器共用）。
 * 从 DSH 用户设置读取语言名，注入「所有对话回复、注释、思考过程必须使用该语言」。
 */
export declare function systemLanguageRule(language: string): string;
/**
 * 语言规则注入行（共享口径：语言名为空/空白时不注入；非空时以句号收尾）。
 * 各编排系构建器复用同一判断，避免「有的注入有的不注入」这类口径漂移。
 */
export declare function languageRuleLine(systemLanguage: string): string;
