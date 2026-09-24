// tests/contract/client-copy.test.ts
//
// 客户端文案门禁（静态文本断言，不验证运行时协作）：
//   1. 词典 zh / en 键路径完全对称、各级无重复键；
//   2. 词典顶层键不得成为死键（必须有 client 源码引用）；
//   3. 不得用字面量兜底词典（`t.x ?? '…'`）：同一语义只允许一处本体；
//   4. 面向用户的中文文案必须走词典：组件与 lib 内不得内联中文（现有存量见 COPY_BASELINE）。
//
// 为什么 zh/en 对称要单独断言：类型层 `en: Dict = typeof zh` 已能拦住大部分漂移，但
// `as Dict` / `Partial<Dict>` / 展开等类型逃逸会绕过它，这里做静态兜底。
// 为什么死键只查顶层：嵌套键存在动态取值（如 `copy.libTab[tab]`），按顶层键判定不会误报。

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { inlineCopyOf, listSourceFiles, parseSource, readText } from './fixtures/client-scan.js'

/** 词典唯一来源（正文内允许中文，故排除在 4 号门禁之外）。 */
const I18N_FILE = 'src/client/i18n.ts'

/** 受门禁约束的客户端源文件（排除词典与样式片段）。 */
const CLIENT_FILES = listSourceFiles('src/client').filter(
  (file) => file !== I18N_FILE && !file.startsWith('src/client/styles/'),
)

/** 词典键路径与重复键。 */
interface DictShape {
  /** 全部键的点号路径（含中间对象节点）。 */
  readonly paths: readonly string[]
  /** 各级重复键（重复即静默丢一份文案）。 */
  readonly duplicates: readonly string[]
}

/** 解析 `export const <name> = { … }` 的嵌套键结构。 */
function dictShapeOf(rel: string, name: string): DictShape {
  const sf = parseSource(rel)
  let initializer: ts.Expression | undefined
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) initializer = declaration.initializer
    }
  }
  const paths: string[] = []
  const duplicates: string[] = []
  const walk = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    const seen = new Set<string>()
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
      const key = property.name.text
      const path = prefix === '' ? key : `${prefix}.${key}`
      if (seen.has(key)) duplicates.push(path)
      seen.add(key)
      paths.push(path)
      if (ts.isObjectLiteralExpression(property.initializer)) walk(property.initializer, path)
    }
  }
  if (initializer !== undefined && ts.isObjectLiteralExpression(initializer)) walk(initializer, '')
  return { paths, duplicates }
}

/**
 * 现有「内联中文文案」存量豁免（冻结基线）。口径：基线与实际必须双向一致——
 * 新增内联文案失败，修好一处却不删除基线条目同样失败（避免豁免清单腐化）。
 * 每条都要能说清「为什么现在还没迁词典、迁去哪」。
 */
const COPY_BASELINE: ReadonlyArray<{ readonly file: string; readonly reason: string; readonly copies: readonly string[] }> = [
  {
    file: 'components/date-picker/DateRangePicker.tsx',
    reason: '日历骨架文案（星期缩写 / 年月标题 / 上下月 / 起止标记），迁移需连同月份与星期格式一起处理',
    copies: ['日', '一', '二', '三', '四', '五', '六', '上一月', '${}年${}月', '下一月', '开始', '结束'],
  },
  {
    file: 'components/time-input/TimeInput.tsx',
    reason: '时间输入文案（触发器占位 / 时 / 分），属调度表单文案，待与 scheduler* 键一并整理',
    copies: ['选择时间', '选择时间', '时', '分'],
  },
  {
    file: 'components/sidebar/library-model.ts',
    reason: '底栏四 Tag 与「父」标记：词典已有同名 libTab.workflow 等键，本轮未做依赖注入改造',
    copies: ['工作流', '角色', '数据', '其他', '父'],
  },
  {
    file: 'components/panels/inspector/role-form.tsx',
    reason: '输入示例占位（如：{query: string}），属示例文案，待确认是否值得进词典',
    copies: ['如：{query: string}', '如：{result: string, pass: boolean}'],
  },
  {
    file: 'lib/graph-handles.ts',
    reason: '接点 title（输入/启动/输出/结束/暂停）：lib 不引词典，迁移需由调用方传入文案',
    copies: ['输入', '启动', '输出', '结束', '暂停'],
  },
  {
    file: 'lib/tool-tags.ts',
    reason: '工具标签（全部 / 官方工具）：lib 层常量，迁移应先决定是否改为由调用方注入词典',
    copies: ['全部', '官方工具'],
  },
  {
    file: 'lib/layout.ts',
    reason: '布局诊断文本（LayoutResult.warnings）：当前只被测试断言、未在界面展示，是否改结构化待定',
    copies: [
      '协作组「${}」卡片高度不足，建议加高到 ${}px 以容纳 ${} 名成员',
      '虚拟节点「${}」引用的主节点不在画布上，已放在末尾列',
    ],
  },
  {
    file: 'lib/remote.ts',
    reason: '网络边界传输层错误文案：错误码已稳定，文案注入需要改动网络边界契约，另行评估',
    copies: [
      '工作流服务响应超时（${}）',
      '无法连接工作流服务：${}',
      '无法连接工作流服务：${}',
      '工作流服务错误（HTTP ${}）',
      '工作流服务错误（HTTP ${}）',
      '流式响应无内容',
    ],
  },
]

/** 基线与实际的多重集合（同一文案出现两次即记两次）。 */
type CopyCounts = Map<string, number>

function copyKey(file: string, copy: string): string {
  return `${file}\u0000${copy}`
}

function toCounts(entries: Iterable<readonly [string, string]>): CopyCounts {
  const counts: CopyCounts = new Map()
  for (const [file, copy] of entries) {
    const key = copyKey(file, copy)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** 实际内联文案（路径口径与 COPY_BASELINE 一致：相对 src/client）。 */
function actualCopies(): CopyCounts {
  return toCounts(
    CLIENT_FILES.flatMap((file) =>
      inlineCopyOf(file).map((copy) => [file.slice('src/client/'.length), copy] as const),
    ),
  )
}

/** 基线文案。 */
function baselineCopies(): CopyCounts {
  return toCounts(COPY_BASELINE.flatMap((entry) => entry.copies.map((copy) => [entry.file, copy] as const)))
}

/** 把计数差集渲染成可读条目（含多寡差异）。 */
function renderDiff(counts: CopyCounts, other: CopyCounts): string[] {
  const lines: string[] = []
  for (const [key, count] of counts) {
    const rest = count - (other.get(key) ?? 0)
    if (rest <= 0) continue
    const [file, copy] = key.split('\u0000')
    lines.push(`${file} :: ${JSON.stringify(copy)}${rest > 1 ? ` ×${rest}` : ''}`)
  }
  return lines.sort()
}

const zh = dictShapeOf(I18N_FILE, 'zh')
const en = dictShapeOf(I18N_FILE, 'en')
const copySource = CLIENT_FILES.map((file) => readText(file)).join('\n')

describe('客户端文案门禁（词典本体）', () => {
  it('词典 zh 与 en 的键路径完全对称', () => {
    expect([...en.paths].sort()).toEqual([...zh.paths].sort())
    // 防止解析口径失效导致门禁空转（例如词典改成函数返回值）。
    expect(zh.paths.length).toBeGreaterThan(200)
  })

  it('词典各级不存在重复键', () => {
    expect(zh.duplicates).toEqual([])
    expect(en.duplicates).toEqual([])
  })
})

describe('客户端文案门禁（键使用率）', () => {
  it('每个顶层词典键都被 client 源码引用（无死键）', () => {
    const topLevel = zh.paths.filter((path) => !path.includes('.'))
    const dead = topLevel.filter((key) => {
      // 键被消费的两种形态：属性访问 `.key`，或作为 reason 码等字符串字面量出现。
      const asProperty = new RegExp(`\\.${key}\\b`)
      return !asProperty.test(copySource) && !copySource.includes(`'${key}'`) && !copySource.includes(`"${key}"`)
    })
    expect(dead).toEqual([])
  })

  it('不得用字面量兜底词典（同一语义只允许一处本体）', () => {
    const offenders: string[] = []
    for (const file of CLIENT_FILES) {
      readText(file)
        .split('\n')
        .forEach((line, index) => {
          if (/\b(t|copy|dict)\.[A-Za-z_$][\w$]*\s*\?\?\s*['"`]/.test(line)) {
            offenders.push(`${file}:${index + 1} ${line.trim()}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})

describe('客户端文案门禁（内联中文文案）', () => {
  it('不得新增内联中文文案，存量豁免不得腐化', () => {
    const actual = actualCopies()
    const baseline = baselineCopies()
    expect(renderDiff(actual, baseline), '新增内联文案：请迁入 src/client/i18n.ts（zh/en 同步）').toEqual([])
    expect(renderDiff(baseline, actual), '基线条目已不存在：请从 COPY_BASELINE 删除该条').toEqual([])
  })

  it('基线覆盖的是真实的客户端源文件（防止路径失效导致门禁空转）', () => {
    const missing = COPY_BASELINE.map((entry) => entry.file).filter((file) => !CLIENT_FILES.includes(`src/client/${file}`))
    expect(missing).toEqual([])
  })

  it('内联文案提取口径仍然命中已知样本（防止提取器失效）', () => {
    // 词典本身有大量中文，说明提取器能识别字符串字面量。
    expect(inlineCopyOf(I18N_FILE).length).toBeGreaterThan(100)
  })
})
