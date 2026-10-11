// tests/contract/client-boundary.test.ts
//
// 客户端依赖与边界门禁（静态文本 / import 断言，不验证运行时协作）：
//   1. client 只允许引用 src/host/shared/**（共享纯类型与纯常量），不得引入 Host 运行时模块；
//   2. host 不得依赖 client 实现（反向依赖）；
//   3. lib 不得依赖 UI 模块（components / hooks）；
//   4. components 不得自行引用网络边界（lib/remote），网络访问只经注入面；
//   5. 基础路径字面量 `/visual-workflow` 只允许出现在统一网络边界（lib/remote.ts）；
//   6. 共享协议常量的字面量值不得在 client 内硬编码（端点名 / 工具名 / 错误码必须引用常量），
//      且其取值取自 src/host/shared/protocol.ts 本体（非测试内副本）。

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  crossLayerViolations, crossLayerViolationsOf, importsOf, isModuleFile, listSourceFiles, moduleRefsOf,
  parseSourceText, readText, resolveSpecifier, stringLiteralsOf,
} from './fixtures/client-scan.js'

const CLIENT_ALL_FILES = listSourceFiles('src/client', ['.ts', '.tsx', '.css', '.md'])
const CLIENT_FILES = CLIENT_ALL_FILES.filter(isModuleFile)
const HOST_FILES = listSourceFiles('src/host')

/** 统一网络边界（唯一允许出现基础路径与端点约定的地方）。 */
const REMOTE_FILE = 'src/client/lib/remote.ts'

/** 共享契约模块前缀。 */
const SHARED_PREFIX = 'src/host/shared/'

/** 从 protocol.ts 原文提取全部 `export const X = '...'` 的字面量取值（长度 > 2）。 */
function protocolValuesOf(protocolSource: string): string[] {
  return [...protocolSource.matchAll(/export const [A-Z0-9_]+\s*=\s*'([^']+)'/g)]
    .map((match) => match[1])
    .filter((value) => value.length > 2)
}

/** 跨层 import 违规：判定委托给扫描夹具（同一口径，且可对受控数据自检）。 */
const isHostRuntimeRef = (_from: string, resolved: string): boolean =>
  resolved.startsWith('src/host/') && !resolved.startsWith(SHARED_PREFIX)

describe('客户端边界门禁（跨层依赖）', () => {
  // 防门禁空转：扫描器必须真的收进真实的引用形态与 client 样式文件，否则下面的集合断言形同虚设。
  it('扫描面自检：收进 export…from / 内联类型引用 import(...) 与 client 样式文件', () => {
    const refs = CLIENT_FILES.flatMap((file) => importsOf(file))
    for (const kind of ['import', 'exportFrom', 'inlineType'] as const) {
      const hits = refs.filter((ref) => ref.kind === kind)
      expect(hits.length, `扫描器未收进 ${kind} 形态的模块引用`).toBeGreaterThan(0)
      // 每条引用都必须带可定位的行号与说明符（断言失败时能指到源码行）
      expect(hits.every((ref) => ref.line > 0 && ref.specifier.length > 0)).toBe(true)
    }
    expect(CLIENT_ALL_FILES).toContain('src/client/entry.css')
  })

  // 提取口径的自证：用受控源码片段验证四种引用形态都会被收进，且跨层判定能命中违规。
  // 片段置于 src/client/hooks/ 深度（与仓库内真实 hooks 同级），`../../host/**` 才真实指向 src/host。
  it('提取口径自证：export…from 与动态 import() 指向 host 运行时模块时会被判为违规', () => {
    const from = 'src/client/hooks/probe-sample.ts'
    const sample = [
      "import { a } from '../../host/shared/types.js'",
      "import { b } from '../../host/orchestrator/index.js'",
      "export * from '../../host/orchestrator/index.js'",
      "const x = (await import('../../host/orchestrator/index.js')) as unknown",
      "type T = import('../../host/orchestrator/index.js').ServiceState",
    ].join('\n')
    const refs = moduleRefsOf(parseSourceText(from, sample, ts.ScriptKind.TS))
    expect(refs.map((ref) => ref.kind)).toEqual(['import', 'import', 'exportFrom', 'dynamic', 'inlineType'])
    const offenders = crossLayerViolationsOf(
      refs.map((ref) => ({ file: from, line: ref.line, specifier: ref.specifier, kind: ref.kind })),
      isHostRuntimeRef,
    )
    // 4 条越层引用（顶层 import / export * from / 动态 import() / 内联类型引用）全部命中，
    // 仅 host/shared 那条合规。
    expect(offenders).toHaveLength(4)
    expect(offenders.filter((entry) => entry.includes('orchestrator/index.js'))).toHaveLength(4)
  })

  // 反例自证：注入 `export * from '../../host/orchestrator/index.js'` 形态时必须转红。
  // 这是 D11C-10 的验收核心——门禁不得退化为「只与测试内硬编码副本比较」。
  it('反例自证：注入指向 src/host 运行时的 export…from 会被单独判定为违规', () => {
    const injected = [{ file: 'src/client/hooks/synthetic.ts', line: 1, specifier: '../../host/orchestrator/index.js', kind: 'exportFrom' as const }]
    const offenders = crossLayerViolationsOf(injected, isHostRuntimeRef)
    expect(offenders).toEqual(['src/client/hooks/synthetic.ts:1 → ../../host/orchestrator/index.js'])
    // 同一判定对合规形态（host/shared）不误报
    expect(crossLayerViolationsOf(
      [{ file: 'src/client/hooks/synthetic.ts', line: 1, specifier: '../../host/shared/types.js', kind: 'import' as const }],
      isHostRuntimeRef,
    )).toEqual([])
  })

  // 动态 import() 当前在 src/client 无真实用例，只靠 AST 收集无法自证；
  // 补一条等价说明符的文本判定，使该形态一旦出现即受阻。
  it('文本兜底：动态 import() 的相对说明符指向 src/host/ 时只允许 src/host/shared/**', () => {
    const offenders: string[] = []
    for (const file of CLIENT_FILES) {
      readText(file)
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(/import\(\s*'(\.[^']*)'/g)) {
            const resolved = resolveSpecifier(file, match[1])
            if (resolved.startsWith('src/host/') && !resolved.startsWith(SHARED_PREFIX)) {
              offenders.push(`${file}:${index + 1} → ${match[1]}`)
            }
          }
        })
    }
    expect(offenders, '动态 import() 是模块引用的一种，同样不得指向 Host 运行时模块').toEqual([])
  })

  it('文本兜底判定自证：越层的动态 import() 说明符会被判为违规', () => {
    const sampleLine = "const mod = await import('../../host/orchestrator/index.js')"
    const matched = [...sampleLine.matchAll(/import\(\s*'(\.[^']*)'/g)]
    expect(matched).toHaveLength(1)
    const resolved = resolveSpecifier('src/client/hooks/probe-sample.ts', matched[0][1])
    expect(resolved).toBe('src/host/orchestrator/index.js')
    expect(resolved.startsWith('src/host/') && !resolved.startsWith(SHARED_PREFIX)).toBe(true)
    // 合规形态（host/shared）不被误报
    const sharedResolved = resolveSpecifier('src/client/hooks/probe-sample.ts', '../../host/shared/types.js')
    expect(sharedResolved.startsWith(SHARED_PREFIX)).toBe(true)
  })

  it('client 引用 host 时只能落在 src/host/shared/**（含 export…from / 内联类型 / 动态 import()）', () => {
    const offenders = crossLayerViolations(CLIENT_FILES, isHostRuntimeRef)
    expect(offenders, '禁止 client 引入 Host 运行时模块；共享契约只能来自 src/host/shared/').toEqual([])
  })

  it('host 不依赖 client 实现', () => {
    const offenders = crossLayerViolations(HOST_FILES, (_from, resolved) => resolved.startsWith('src/client/'))
    expect(offenders, 'Host 不得依赖 Client 实现（依赖方向单向）').toEqual([])
  })

  it('lib 不依赖 UI 模块（components / hooks）', () => {
    const offenders = crossLayerViolations(
      CLIENT_FILES.filter((file) => file.startsWith('src/client/lib/')),
      (_from, resolved) => /^src\/client\/(components|hooks)\//.test(resolved),
    )
    expect(offenders, 'lib 必须与 UI 生命周期无关：纯逻辑不得反向依赖 components / hooks').toEqual([])
  })

  it('components 不自行引用网络边界（lib/remote）', () => {
    const offenders = crossLayerViolations(
      CLIENT_FILES.filter((file) => file.startsWith('src/client/components/')),
      (_from, resolved) => resolved === REMOTE_FILE.replace(/\.ts$/, '.js') || resolved === REMOTE_FILE,
    )
    expect(offenders, '网络访问只经注入面（hooks 注入的 remote face），组件不得自建数据访问路径').toEqual([])
  })
})

describe('客户端边界门禁（契约字面量）', () => {
  it('基础路径 /visual-workflow 只出现在统一网络边界', () => {
    const offenders: string[] = []
    for (const file of CLIENT_FILES) {
      if (file === REMOTE_FILE) continue
      if (stringLiteralsOf(file).some((literal) => literal.includes('/visual-workflow'))) offenders.push(file)
    }
    expect(offenders).toEqual([])
    // 防门禁空转：网络边界本身确实持有该字面量。
    expect(stringLiteralsOf(REMOTE_FILE).some((literal) => literal.includes('/visual-workflow'))).toBe(true)
  })

  it('共享协议常量的字面量值不得在 client 内硬编码', () => {
    const protocolSource = readText('src/host/shared/protocol.ts')
    const values = protocolValuesOf(protocolSource)
    expect(values.length).toBeGreaterThan(20)
    const offenders: string[] = []
    for (const file of CLIENT_FILES) {
      if (file === 'src/client/i18n.ts' || file.startsWith('src/client/styles/')) continue
      const literals = new Set(stringLiteralsOf(file))
      for (const value of values) {
        if (literals.has(value)) offenders.push(`${file} 硬编码了协议常量值 ${JSON.stringify(value)}`)
      }
    }
    expect(offenders, '端点名 / 工具名 / 错误码一律引用共享契约常量，不得硬编码字面量').toEqual([])
  })

  it('协议常量取值与常量名一一对应（期望值取自 protocol.ts 本体，非测试内副本）', () => {
    const protocolSource = readText('src/host/shared/protocol.ts')
    const declared = protocolValuesOf(protocolSource)
    // 端点名与稳定错误码是两种命名族，各自都必须真的从源文件里解析出来（防解析退化为空集）。
    expect(declared.filter((value) => !/^(FLOW|WF)_/.test(value)).length).toBeGreaterThan(3)
    expect(declared.filter((value) => /^(FLOW|WF)_/.test(value)).length).toBeGreaterThan(3)
    // EP_* 家族：每个常量名去掉 EP_ 前缀、转小驼峰后必须等于它的字面量值。
    const endpointEntries = [...protocolSource.matchAll(/export const EP_([A-Z0-9_]+)\s*=\s*'([^']+)'/g)]
    expect(endpointEntries.length).toBeGreaterThan(30)
    for (const [, suffix, value] of endpointEntries) {
      const camel = suffix.toLowerCase().replace(/_([a-z0-9])/g, (_all, ch: string) => ch.toUpperCase())
      expect(value, `EP_${suffix} 的取值与常量名不再对应`).toBe(camel)
    }
    // ERR_* 家族：错误码必须是 FLOW_/WF_ 前缀的稳定码（错误码命名约定）。
    const errorEntries = [...protocolSource.matchAll(/export const (ERR_[A-Z0-9_]+)\s*=\s*'([^']+)'/g)]
    expect(errorEntries.length).toBeGreaterThan(3)
    for (const [, name, value] of errorEntries) {
      expect(value, `${name} 不是稳定错误码形态`).toMatch(/^(FLOW|WF)_[A-Z0-9_]+$/)
    }
  })
})
