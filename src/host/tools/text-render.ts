// src/host/tools/text-render.ts
//
// 工具输出统一渲染：把工具的 canonical JSON 值转成模型可见的稳定文本。
//
// 为什么必须「键序稳定」：工具结果文本进入对话历史后即成为请求前缀的一部分——
// 同一工具同一值在每次请求中必须字节一致，否则前缀缓存失配、整体失效。
// JSON.stringify 按对象插入序输出，而对象键序取决于构造代码；为彻底消除这类
// 漂移，这里对值做递归「按键名排序」的稳定序列化（值本身由输出 schema 约束，
// 无循环引用；数组保持元素顺序——顺序是语义）。
//
// 额外约定：字符串值原样输出（不带引号，模型更易读）；null/undefined 归一为 null。

/** 输出块（工具 render 返回形态：text 块数组）。 */
export interface RenderTextBlock {
  type: 'text'
  text: string
}

/** 递归按键名排序的稳定 JSON 序列化（键序稳定；数组保持原序）。 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined) // undefined 字段不入序列化（JSON 语义）
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return String(value)
}

/**
 * 统一工具输出渲染：字符串原样、结构化值稳定序列化（键序稳定）。
 * 所有 wf_* 工具与数据工具共用，保证结果文本形态一致。
 */
export function textRender(_args: Record<string, unknown>, value: unknown): RenderTextBlock[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  return [{ type: 'text', text: stableStringify(value ?? null) }]
}
