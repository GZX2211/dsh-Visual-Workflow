// src/host/prompts/prompt-rules.ts
//
// 跨构建器共享的面向模型规则措辞（单一措辞源）。
//
// 为什么独立成文件：系统语言规则被编排系、父代理执行单元、规划变体与编排变更通知
// 共同注入。若把它定义在某个具体构建器（如节点任务块）内，其余构建器就得依赖那个
// 主题文件，形成「编排 → 节点任务块」这类并不存在的语义依赖；共享措辞集中于此，
// 构建器之间只共享措辞，不互相依赖主题文件。
//
// 纯度：纯函数，无 IO / 时钟 / 随机源（同一入参输出字节相同）。
/**
 * 系统语言规则短语（面向模型中文；各提示词构建器共用）。
 * 从 DSH 用户设置读取语言名，注入「所有对话回复、注释、思考过程必须使用该语言」。
 */
export function systemLanguageRule(language) {
    return `所有对话回复、注释、思考过程必须使用${language}`;
}
/**
 * 语言规则注入行（共享口径：语言名为空/空白时不注入；非空时以句号收尾）。
 * 各编排系构建器复用同一判断，避免「有的注入有的不注入」这类口径漂移。
 */
export function languageRuleLine(systemLanguage) {
    return String(systemLanguage ?? '').trim() ? `${systemLanguageRule(systemLanguage)}。` : '';
}
//# sourceMappingURL=prompt-rules.js.map