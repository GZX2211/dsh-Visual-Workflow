/** 模板变量表：值经 String() 写入；null / undefined 视为缺失（空串）。 */
export type TemplateVars = Record<string, string | number | boolean | null | undefined>;
/**
 * 渲染模板（纯函数）：可选块 → 变量替换 → 残留占位符检查。
 *
 * @param template - texts/ 下的整段模板正文。
 * @param vars - 变量表（调用方组装；列表类内容请先渲染成一段文本再传入）。
 * @returns 可直接注入模型的最终文本。
 * @throws 模板语法错误（块不配对、缺变量名）或渲染后仍有未替换占位符。
 */
export declare function renderTemplate(template: string, vars: TemplateVars): string;
/** 布尔变量渲染：真值给 '1'，假值给空串（供 `{{#if}}` 使用）。 */
export declare function flag(value: boolean): string;
