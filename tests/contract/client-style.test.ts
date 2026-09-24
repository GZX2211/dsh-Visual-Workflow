// tests/contract/client-style.test.ts
//
// 客户端样式门禁（静态文本断言，不验证运行时渲染）：
//   1. 片段登记完整：styles/ 下每个片段都被 index.ts 引入，且引入顺序与拼接顺序一致
//      （顺序即覆盖顺序，漏登记会静默丢样式）；
//   2. 无死类名：styles 里定义的 .wf-* 必须在 client 源码中被引用（动态拼接前缀除外）；
//   3. token 单一来源：`var(--wf-*)` 引用必须在 tokens.ts 有定义，定义必须被引用；
//   4. 颜色字面量只允许出现在 tokens.ts（存量见 COLOR_BASELINE）；
//   5. 不使用 CSS Modules，`.css` 直接导入只允许 entry.ts 的注入占位；
//   6. 禁止静态内联样式：值全为字面量的 style={{…}} 必须落成语义类（存量见 INLINE_STYLE_BASELINE）。

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { importsOf, listSourceFiles, parseSource, readText, stripCssComments } from './fixtures/client-scan.js'

const STYLE_DIR = 'src/client/styles'
const INDEX_FILE = `${STYLE_DIR}/index.ts`
const TOKENS_FILE = `${STYLE_DIR}/tokens.ts`

const STYLE_FILES = listSourceFiles(STYLE_DIR)
const FRAGMENTS = STYLE_FILES.filter((file) => file !== INDEX_FILE)
/** 样式之外、会消费类名的客户端源码。 */
const CONSUMER_FILES = listSourceFiles('src/client').filter((file) => !file.startsWith(`${STYLE_DIR}/`))
const CONSUMER_SOURCE = CONSUMER_FILES.map((file) => readText(file)).join('\n')
const INDEX_SOURCE = readText(INDEX_FILE)

/**
 * 颜色字面量存量豁免（冻结基线）。口径与文案门禁一致：双向比对，修好一处就要删一条。
 */
const COLOR_BASELINE: ReadonlyArray<{ readonly file: string; readonly literal: string; readonly reason: string }> = [
  {
    file: 'src/client/styles/scheduler.ts',
    literal: '#e6b23c',
    reason: '定时任务「等待」态圆点色未入 token；应评估并入 --wf-warn 或新增等待态 token',
  },
]

/** 静态内联样式存量豁免（冻结基线）：file → 允许的处数。 */
const INLINE_STYLE_BASELINE: ReadonlyArray<{ readonly file: string; readonly count: number; readonly reason: string }> = [
  {
    file: 'components/canvas/CanvasEdges.tsx',
    count: 1,
    reason: '.wf-graph__edges 已声明 position/inset/overflow，内联值与之重复，可直接删除内联样式',
  },
  {
    file: 'components/canvas/GroupCard.tsx',
    count: 5,
    reason: '组内成员接点的固定纵向位置（top:30%/47%/50%/64%）应改为语义类',
  },
  {
    file: 'components/panels/inspector/role-form.tsx',
    count: 3,
    reason: 'minHeight:130 与 whiteSpace:nowrap 属固定排版值，应改为语义类',
  },
  {
    file: 'components/run-history/RunHistory.tsx',
    count: 1,
    reason: '空态文字 color/fontSize 应改为语义类（当前不在 .wf-inspector 内，不能复用 .wf-empty）',
  },
  {
    file: 'components/sidebar/LeftPanel.tsx',
    count: 1,
    reason: '空态提示 padding 应改为语义类',
  },
  {
    file: 'components/toolbar/Toolbar.tsx',
    count: 1,
    reason: "SVG color:'currentColor' 可下沉到样式表的 .wf-toolbar svg",
  },
]

/** 片段模块名（不含扩展名）。 */
function fragmentName(file: string): string {
  return file.slice(`${STYLE_DIR}/`.length).replace(/\.ts$/, '')
}

/** 值表达式是否为字面量（静态样式值不允许内联）。 */
function isLiteralValue(node: ts.Expression): boolean {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true
  return ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)
}

/** 值全为字面量的内联 style 处数（含至少一个属性）。 */
function staticInlineStyleCount(rel: string): number {
  const sf = parseSource(rel)
  let count = 0
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sf) === 'style' &&
      node.initializer !== undefined &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression
      if (
        expression !== undefined &&
        ts.isObjectLiteralExpression(expression) &&
        expression.properties.length > 0 &&
        expression.properties.every((property) => ts.isPropertyAssignment(property) && isLiteralValue(property.initializer))
      ) {
        count += 1
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return count
}

/** index.ts 的片段 import（模块名 + 导出名）。 */
const FRAGMENT_IMPORTS = [...INDEX_SOURCE.matchAll(/import \{ (\w+) \} from '\.\/([\w-]+)\.js'/g)].map((match) => ({
  module: match[2],
  exportName: match[1],
}))

describe('客户端样式门禁（片段装配）', () => {
  it('styles/ 下每个片段都被 index.ts 引入，且无悬空引用', () => {
    expect(FRAGMENT_IMPORTS.map((entry) => entry.module).sort()).toEqual(FRAGMENTS.map(fragmentName).sort())
  })

  it('index.ts 的 import 顺序与拼接数组顺序一致（顺序即覆盖顺序）', () => {
    const arrayBlock = /const parts: string\[\] = \[([\s\S]*?)\n\]/.exec(INDEX_SOURCE)
    expect(arrayBlock).not.toBeNull()
    const order = [...(arrayBlock?.[1] ?? '').matchAll(/^\s*(\w+),/gm)].map((match) => match[1])
    expect(order).toEqual(FRAGMENT_IMPORTS.map((entry) => entry.exportName))
  })
})

describe('客户端样式门禁（类名使用率）', () => {
  it('不存在只在样式表里定义、源码从未引用的类名', () => {
    const declared = new Set<string>()
    for (const file of FRAGMENTS) {
      for (const match of stripCssComments(readText(file)).matchAll(/\.(wf-[A-Za-z0-9_-]+)/g)) declared.add(match[1])
    }
    // 动态拼接（wf-node--${displayKind}）按其前缀整体放行。
    const dynamicPrefixes = [...CONSUMER_SOURCE.matchAll(/wf-([a-z0-9-]+)--\$\{/g)].map((match) => `wf-${match[1]}--`)
    expect(dynamicPrefixes.length).toBeGreaterThan(0)
    const dead = [...declared]
      .filter((name) => !CONSUMER_SOURCE.includes(name) && !dynamicPrefixes.some((prefix) => name.startsWith(prefix)))
      .sort()
    expect(dead).toEqual([])
  })
})

describe('客户端样式门禁（设计 token）', () => {
  it('var(--wf-*) 引用必须在 tokens.ts 有定义', () => {
    const defined = new Set([...readText(TOKENS_FILE).matchAll(/(--wf-[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
    const referenced = new Set(
      STYLE_FILES.flatMap((file) => [...readText(file).matchAll(/var\((--wf-[a-z0-9-]+)/g)].map((match) => match[1])),
    )
    const undefinedRefs = [...referenced].filter((name) => !defined.has(name)).sort()
    expect(undefinedRefs).toEqual([])
    expect(defined.size).toBeGreaterThan(10)
  })

  it('tokens.ts 中定义的每个 token 都被样式引用（无死 token）', () => {
    const defined = [...readText(TOKENS_FILE).matchAll(/(--wf-[a-z0-9-]+)\s*:/g)].map((match) => match[1])
    const referenced = new Set(
      STYLE_FILES.flatMap((file) => [...readText(file).matchAll(/var\((--wf-[a-z0-9-]+)/g)].map((match) => match[1])),
    )
    expect(defined.filter((name) => !referenced.has(name)).sort()).toEqual([])
  })

  it('颜色字面量只允许出现在 tokens.ts', () => {
    const pattern =
      /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black|red|lime|blue|yellow|cyan|magenta|silver|gray|grey|maroon|olive|green|purple|teal|navy|orange|pink|brown)(?![\w-])/g
    const found: Array<{ file: string; literal: string }> = []
    for (const file of FRAGMENTS) {
      if (file === TOKENS_FILE) continue
      for (const match of stripCssComments(readText(file)).matchAll(pattern)) found.push({ file, literal: match[0] })
    }
    const allowed = new Map<string, number>()
    for (const entry of COLOR_BASELINE) {
      const key = `${entry.file}\u0000${entry.literal}`
      allowed.set(key, (allowed.get(key) ?? 0) + 1)
    }
    const actual = new Map<string, number>()
    for (const hit of found) {
      const key = `${hit.file}\u0000${hit.literal}`
      actual.set(key, (actual.get(key) ?? 0) + 1)
    }
    const render = (counts: Map<string, number>, other: Map<string, number>): string[] =>
      [...counts.entries()]
        .map(([key, count]) => [key, count - (other.get(key) ?? 0)] as const)
        .filter(([, rest]) => rest > 0)
        .map(([key]) => key.replace('\u0000', ' :: '))
        .sort()
    expect(render(actual, allowed), '新增颜色字面量：请下沉到 tokens.ts').toEqual([])
    expect(render(allowed, actual), '基线条目已不存在：请从 COLOR_BASELINE 删除该条').toEqual([])
  })
})

describe('客户端样式门禁（注入契约）', () => {
  it('不使用 CSS Modules，且 .css 直接导入只允许 entry.ts 的注入占位', () => {
    const offenders: string[] = []
    for (const file of listSourceFiles('src/client')) {
      for (const ref of importsOf(file)) {
        if (ref.specifier.endsWith('.module.css')) offenders.push(`${file}:${ref.line} ${ref.specifier}`)
        else if (ref.specifier.endsWith('.css') && file !== 'src/client/entry.ts') {
          offenders.push(`${file}:${ref.line} ${ref.specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('客户端样式门禁（内联样式）', () => {
  it('不得新增静态内联样式，存量豁免不得腐化', () => {
    const actual = new Map<string, number>()
    for (const file of CONSUMER_FILES.filter((name) => name.endsWith('.tsx'))) {
      const count = staticInlineStyleCount(file)
      if (count > 0) actual.set(file.slice('src/client/'.length), count)
    }
    const baseline = new Map(INLINE_STYLE_BASELINE.map((entry) => [entry.file, entry.count]))
    const render = (counts: Map<string, number>, other: Map<string, number>): string[] =>
      [...counts.entries()]
        .map(([file, count]) => [file, count - (other.get(file) ?? 0)] as const)
        .filter(([, rest]) => rest > 0)
        .map(([file, rest]) => `${file} +${rest}`)
        .sort()
    expect(render(actual, baseline), '新增静态内联样式：请改为语义类名（样式集中在 styles/）').toEqual([])
    expect(render(baseline, actual), '基线条目已不存在：请从 INLINE_STYLE_BASELINE 删除该条').toEqual([])
  })
})
