// tests/host/api/error-status.test.ts
//
// IF-10 门禁：稳定错误码 → HTTP 状态映射的穷举性。
//
// 为什么用源码扫描而不是手写清单：未登记的稳定码会静默落 statusOf 的 500 兜底——调用方
// 错误（入参/身份/状态前置）被响应成 500 后，客户端只能展示通用错误、无法按码分支；而
// 手写清单会随新增码悄悄过期（新增码没有第二处提醒）。断言「全仓 WF_* 字面量 ⊆
// ERROR_STATUS ∪ 显式豁免」才能把新码挡在门外。
//
// 逐码判定理由写在 src/host/api/routes.ts 的表内注释；本文件锁定判定结果与不变式。

import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ERROR_STATUS, ERROR_STATUS_EXEMPT } from '../../../src/host/api/routes.js'

const hostRoot = fileURLToPath(new URL('../../../src/host/', import.meta.url))

/** 递归收集目录下全部 .ts 文件。 */
async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listSourceFiles(full))
    else if (entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

/**
 * 提取全仓稳定错误码字面量（'WF_*' / "WF_*"）。
 * 只认「被引号完整包围的码」：错误消息里的 'WF_BAD_ARGS: ...' 不是码定义，不入选。
 */
async function collectStableCodes(): Promise<Map<string, string[]>> {
  const pattern = /['"](WF_[A-Z0-9_]+)['"]/g
  const found = new Map<string, string[]>()
  for (const file of await listSourceFiles(hostRoot)) {
    const text = await readFile(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        const code = match[1]
        const sites = found.get(code) ?? []
        sites.push(`${file.slice(hostRoot.length).replace(/\\/g, '/')}:${index + 1}`)
        found.set(code, sites)
      }
    })
  }
  return found
}

const HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 409, 413, 422, 429, 500, 501, 502, 503])

describe('稳定错误码 → HTTP 状态穷举（IF-10）', () => {
  it('全仓 WF_* 稳定码都已在 ERROR_STATUS 登记，或显式列为豁免', async () => {
    const found = await collectStableCodes()
    // 扫描自身必须有效：扫不到码说明路径/正则失效，否则本用例会静默变成空断言
    expect(found.size, '未从 src/host 扫到任何稳定码，扫描失效').toBeGreaterThan(50)
    const unclassified: string[] = []
    for (const [code, sites] of [...found.entries()].sort()) {
      if (ERROR_STATUS[code] !== undefined) continue
      if (ERROR_STATUS_EXEMPT[code] !== undefined) continue
      unclassified.push(`${code}（${[...new Set(sites)].join(', ')}）`)
    }
    expect(unclassified, '未登记也未豁免的稳定码（会静默落 500 兜底）').toEqual([])
  })

  it('表内取值都是合法 HTTP 状态码', () => {
    const invalid = Object.entries(ERROR_STATUS).filter(([, status]) => !HTTP_STATUSES.has(status))
    expect(invalid).toEqual([])
  })

  it('豁免项必须写明依据，且不得与映射表重叠（同码两处说了算）', () => {
    const missingReason = Object.entries(ERROR_STATUS_EXEMPT)
      .filter(([, reason]) => !String(reason ?? '').trim())
      .map(([code]) => code)
    expect(missingReason).toEqual([])
    const overlapping = Object.keys(ERROR_STATUS_EXEMPT).filter((code) => ERROR_STATUS[code] !== undefined)
    expect(overlapping, '同一码不能既映射又豁免').toEqual([])
  })

  it('调用方错误一律 4xx（关键判定锁定；含本次补齐的码）', () => {
    // 这些码的语义都是「调用方要改的东西」（入参/身份/作用域/状态前置/图语义），
    // 落 500 会让客户端无法按码分支；逐一锁定防止回退。
    const callerErrors: Record<string, number> = {
      WF_BAD_CALLER: 400,
      WF_CANCELLED: 409,
      WF_GRAPH_INVALID: 422,
      WF_SCOPE_INVALID: 400,
      WF_NOT_ROOT: 403,
      WF_NO_ACTIVE_RUN: 409,
    }
    for (const [code, expected] of Object.entries(callerErrors)) {
      expect(ERROR_STATUS[code], `${code} 必须登记为 ${expected}`).toBe(expected)
    }
  })

  it('工具层 WF_DB_* 整体豁免，且依据写明「只经工具面」', () => {
    const dbCodes = Object.keys(ERROR_STATUS_EXEMPT).filter((code) => code.startsWith('WF_DB_'))
    expect(dbCodes.sort()).toEqual([
      'WF_DB_BAD_DATA',
      'WF_DB_CONFIG',
      'WF_DB_DRIVER_MISSING',
      'WF_DB_INDEX_MISSING',
      'WF_DB_NO_LINE',
      'WF_DB_SQL',
    ])
    for (const code of dbCodes) {
      expect(ERROR_STATUS_EXEMPT[code]).toContain('工具面')
    }
  })
})
