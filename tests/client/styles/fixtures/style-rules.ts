// tests/client/styles/fixtures/style-rules.ts
//
// 样式片段静态解析：把 `export const xxxStyles = \`...\`` 里的 CSS 文本切成
// `{ selector, media, declarations }` 三元组，供规则语义断言使用（jsdom 不计算伪类与 @media）。
// 只支持本仓库的写法（普通规则 + 可嵌套 at-rule 块）；块未闭合直接抛错，避免解析器静默吞规则。

export interface StyleRule {
  /** 单个选择器（选择器组已按顶层逗号拆开，内部空白已折叠）。 */
  readonly selector: string
  /** 祖先 @media 条件；不在媒体查询内为 null。 */
  readonly media: string | null
  readonly declarations: ReadonlyMap<string, string>
}

/** 按顶层逗号拆分选择器组（:not(...) 内的逗号不拆）。 */
function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = []
  let depth = 0
  let current = ''
  for (const char of selectorList) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      if (current.trim() !== '') selectors.push(current.trim().replace(/\s+/g, ' '))
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') selectors.push(current.trim().replace(/\s+/g, ' '))
  return selectors
}

/** 声明块 → 属性表（值内空白折叠）。 */
function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>()
  for (const chunk of body.split(';')) {
    const text = chunk.trim()
    if (text === '') continue
    const colon = text.indexOf(':')
    if (colon === -1) continue
    declarations.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim().replace(/\s+/g, ' '))
  }
  return declarations
}

/** 把样式片段切成规则三元组。 */
export function parseStyleRules(css: string): StyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: StyleRule[] = []
  const parseRange = (start: number, end: number, media: string | null): void => {
    let index = start
    while (index < end) {
      const open = text.indexOf('{', index)
      if (open === -1 || open >= end) return
      const header = text.slice(index, open).trim()
      let depth = 1
      let cursor = open + 1
      while (cursor < end && depth > 0) {
        if (text[cursor] === '{') depth += 1
        else if (text[cursor] === '}') depth -= 1
        cursor += 1
      }
      if (depth !== 0) throw new Error(`样式片段解析失败：${header} 的块未闭合`)
      const bodyEnd = cursor - 1
      if (header.startsWith('@')) {
        parseRange(open + 1, bodyEnd, header)
      } else {
        const declarations = parseDeclarations(text.slice(open + 1, bodyEnd))
        for (const selector of splitSelectorList(header)) rules.push({ selector, media, declarations })
      }
      index = cursor
    }
  }
  parseRange(0, text.length, null)
  return rules
}

/** 星期按钮的悬停规则（「每天」按钮共用 .wf-sched-day）；`:not(:hover)` 里的 hover 不算悬停规则。 */
export function dayHoverRulesOf(rules: readonly StyleRule[]): StyleRule[] {
  return rules.filter(
    (rule) => rule.selector.includes('.wf-sched-day') && rule.selector.includes(':hover') && !/:not\([^)]*:hover\)/.test(rule.selector),
  )
}

/** 焦点复位规则：排除选中态与键盘焦点态、且指针不在按钮上。 */
export function focusResetRulesOf(rules: readonly StyleRule[]): StyleRule[] {
  return rules.filter(
    (rule) =>
      rule.selector.includes('.wf-sched-day') &&
      rule.selector.includes(':focus') &&
      rule.selector.includes(':not(:focus-visible)') &&
      rule.selector.includes(':not(.is-active)'),
  )
}

/** 键盘焦点规则：选择器里的 :focus-visible 不是被 :not 排除的那种。 */
export function keyboardFocusRulesOf(rules: readonly StyleRule[]): StyleRule[] {
  return rules.filter(
    (rule) =>
      rule.selector.includes('.wf-sched-day') &&
      rule.selector.includes(':focus-visible') &&
      !rule.selector.includes(':not(:focus-visible)'),
  )
}

/** 任意焦点状态下的星期按钮规则（不区分键盘/鼠标）。 */
export function anyFocusRulesOf(rules: readonly StyleRule[]): StyleRule[] {
  return rules.filter(
    (rule) => rule.selector.includes('.wf-sched-day') && rule.selector.includes(':focus') && !rule.selector.includes(':focus-visible'),
  )
}

/** 选中态规则。 */
export function activeRulesOf(rules: readonly StyleRule[]): StyleRule[] {
  return rules.filter((rule) => rule.selector.includes('.wf-sched-day.is-active'))
}

/** 媒体查询条件是否把悬停限定在「具备悬停能力的精细指针设备」。 */
export function gatesHoverToFinePointer(media: string | null): boolean {
  if (media === null) return false
  return /(?:any-)?hover:\s*hover/.test(media) && /(?:any-)?pointer:\s*fine/.test(media)
}

/** 声明里是否有可见的焦点指示（外描边或阴影，任一即可）。 */
export function hasVisibleFocusRing(declarations: ReadonlyMap<string, string>): boolean {
  const outline = declarations.get('outline')
  if (outline !== undefined && outline !== 'none' && !outline.startsWith('0')) return true
  const style = declarations.get('outline-style')
  const width = declarations.get('outline-width')
  if (style !== undefined && style !== 'none' && width !== '0' && width !== '0px') return true
  const shadow = declarations.get('box-shadow')
  return shadow !== undefined && shadow !== 'none'
}

/** 焦点圈是否被清除（outline 与 box-shadow 都必须清）。 */
export function clearsFocusRing(declarations: ReadonlyMap<string, string>): boolean {
  const outline = declarations.get('outline')
  const style = declarations.get('outline-style')
  const outlineCleared = outline === '0' || outline === 'none' || style === 'none'
  return outlineCleared && declarations.get('box-shadow') === 'none'
}
