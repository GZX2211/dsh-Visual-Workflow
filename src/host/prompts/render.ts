// src/host/prompts/render.ts
//
// 提示词模板的**唯一渲染器**：把 texts/ 下的整段文本按显式占位符渲染成最终注入文本。
//
// 语法只有两种，目的是让模板能整段阅读、整段修改：
//   1. {{name}}                     变量替换（缺失或空 → 空串）
//   2. {{#if name}}…{{/if}}         可选块（支持嵌套；falsy 时整块消失）
// 条件块按「最内层先处理」配对，因此嵌套写法与阅读顺序一致。
//
// 渲染后仍残留 `{{` 即抛错：占位符名写错不得静默留空（开发期与测试期的唯一护栏）。

/** 模板变量表：值经 String() 写入；null / undefined 视为缺失（空串）。 */
export type TemplateVars = Record<string, string | number | boolean | null | undefined>

/** 缺失或空值判定（空串、false、0 之外的假值一律按缺失处理）。 */
function isEmptyValue(value: TemplateVars[string]): boolean {
  return value === undefined || value === null || value === false || value === 0 || String(value).trim() === ''
}

/**
 * 处理全部可选块（支持嵌套）：每次都取出「第一个 `{{/if}}` 与其最近的 `{{#if }}`」这一对最内层块，
 * 按变量真值决定保留块体还是删除整块，循环直到没有块为止。
 */
function renderOptionalBlocks(template: string, vars: TemplateVars): string {
  let out = template
  for (;;) {
    const closeIndex = out.indexOf('{{/if}}')
    if (closeIndex < 0) break
    const openIndex = out.lastIndexOf('{{#if ', closeIndex)
    if (openIndex < 0) throw new Error('renderTemplate: 存在没有对应 {{#if}} 的 {{/if}}')
    const headEnd = out.indexOf('}}', openIndex)
    if (headEnd < 0 || headEnd > closeIndex) throw new Error('renderTemplate: 可选块起始标记缺少 }}')
    const name = out.slice(openIndex + '{{#if '.length, headEnd).trim()
    if (!name) throw new Error('renderTemplate: 可选块缺少变量名')
    const body = out.slice(headEnd + 2, closeIndex)
    const keep = isEmptyValue(vars[name]) ? '' : body
    out = out.slice(0, openIndex) + keep + out.slice(closeIndex + '{{/if}}'.length)
  }
  return out
}

/**
 * 渲染模板（纯函数）：可选块 → 变量替换 → 残留占位符检查。
 *
 * @param template - texts/ 下的整段模板正文。
 * @param vars - 变量表（调用方组装；列表类内容请先渲染成一段文本再传入）。
 * @returns 可直接注入模型的最终文本。
 * @throws 模板语法错误（块不配对、缺变量名）或渲染后仍有未替换占位符。
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = renderOptionalBlocks(template, vars)
  out = out.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const value = vars[name]
    return value === undefined || value === null ? '' : String(value)
  })
  const leftover = out.indexOf('{{')
  if (leftover >= 0) {
    throw new Error(`renderTemplate: 未替换的占位符 → ${out.slice(leftover, leftover + 48)}`)
  }
  return out
}

/** 布尔变量渲染：真值给 '1'，假值给空串（供 `{{#if}}` 使用）。 */
export function flag(value: boolean): string {
  return value ? '1' : ''
}
