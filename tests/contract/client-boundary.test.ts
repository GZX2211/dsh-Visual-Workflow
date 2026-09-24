// tests/contract/client-boundary.test.ts
//
// 客户端依赖与边界门禁（静态文本 / import 断言，不验证运行时协作）：
//   1. client 只允许引用 src/host/shared/**（共享纯类型与纯常量），不得引入 Host 运行时模块；
//   2. host 不得依赖 client 实现（反向依赖）；
//   3. lib 不得依赖 UI 模块（components / hooks）；
//   4. components 不得自行引用网络边界（lib/remote），网络访问只经注入面；
//   5. 基础路径字面量 `/visual-workflow` 只允许出现在统一网络边界（lib/remote.ts）；
//   6. 共享协议常量的字面量值不得在 client 内硬编码（端点名 / 工具名 / 错误码必须引用常量）。

import { describe, expect, it } from 'vitest'
import { importsOf, listSourceFiles, readText, resolveSpecifier, stringLiteralsOf } from './fixtures/client-scan.js'

const CLIENT_FILES = listSourceFiles('src/client')
const HOST_FILES = listSourceFiles('src/host')

/** 统一网络边界（唯一允许出现基础路径与端点约定的地方）。 */
const REMOTE_FILE = 'src/client/lib/remote.ts'

/** 共享契约模块前缀。 */
const SHARED_PREFIX = 'src/host/shared/'

/** 跨层 import 违规：返回可读的违规清单。 */
function crossLayerViolations(
  files: readonly string[],
  isViolation: (from: string, resolved: string) => boolean,
): string[] {
  const offenders: string[] = []
  for (const file of files) {
    for (const ref of importsOf(file)) {
      if (!ref.specifier.startsWith('.')) continue
      const resolved = resolveSpecifier(file, ref.specifier)
      if (isViolation(file, resolved)) offenders.push(`${file}:${ref.line} → ${ref.specifier}`)
    }
  }
  return offenders
}

describe('客户端边界门禁（跨层依赖）', () => {
  it('client 引用 host 时只能落在 src/host/shared/**', () => {
    const offenders = crossLayerViolations(CLIENT_FILES, (_from, resolved) => {
      return resolved.startsWith('src/host/') && !resolved.startsWith(SHARED_PREFIX)
    })
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
    const values = [...protocolSource.matchAll(/export const [A-Z0-9_]+\s*=\s*'([^']+)'/g)]
      .map((match) => match[1])
      .filter((value) => value.length > 2)
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
})
