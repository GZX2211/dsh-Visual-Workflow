// tests/host/api/boundary.test.ts
//
// 端点白名单与分发（api/boundary.ts）：白名单与共享协议常量零漂移、
// 未知端点 404、原型链方法不可达，以及呈现语言能力缝的降级口径。

import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as EP from '../../../src/host/shared/protocol.js'
import { VisualWorkflowApi } from '../../../src/host/api/index.js'
import { isChinesePresentation, presentationOf } from '../../../src/host/api/boundary.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('端点白名单与分发', () => {
  it('白名单与共享协议的显式端点清单完全一致（零漂移）', () => {
    expect([...VisualWorkflowApi.ENDPOINTS].sort()).toEqual([...EP.ENDPOINT_NAMES].sort())
    // 非端点协议字符串（错误码/工具名）不得进入白名单——旧口径由 Object.values(EP) 派生，
    // 会把它们一并登记为「合法端点」。
    for (const nonEndpoint of [EP.ERR_ASSET_NOT_FOUND, EP.WF_RUN_NODE, EP.ERR_REVISION_CONFLICT]) {
      expect(VisualWorkflowApi.ENDPOINTS.has(nonEndpoint), `${nonEndpoint} 不是端点，不应在白名单内`).toBe(false)
    }
  })

  it('未知端点 404；原型链方法不可达；非端点协议字符串同样 404', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('constructor', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('__proto__', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('noSuchEndpoint', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle(EP.ERR_ASSET_NOT_FOUND, {})).rejects.toMatchObject({ status: 404 })
  })

  it('端点清单与协议常量集合同步：ENDPOINT_NAMES ⊆ protocol 字符串导出，且无重复', () => {
    const protocolStrings = new Set(
      (Object.values(EP) as unknown[]).filter((value): value is string => typeof value === 'string'),
    )
    for (const name of EP.ENDPOINT_NAMES) {
      expect(protocolStrings.has(name), `端点 ${name} 未在 protocol.ts 里定义常量`).toBe(true)
    }
    expect(new Set(EP.ENDPOINT_NAMES).size).toBe(EP.ENDPOINT_NAMES.length)
  })

  it('端点组方法集合 ⊆ 白名单（新增端点必须同时登记白名单，否则 404）', () => {
    const baseOwn = new Set(Object.getOwnPropertyNames(VisualWorkflowApi.prototype))
    const endpointGroupsDir = fileURLToPath(new URL('../../../src/host/api/', import.meta.url))
    const groupFiles = readdirSync(endpointGroupsDir).filter(
      (name) => name.endsWith('.ts') && !['boundary.ts', 'http.ts', 'index.ts', 'routes.ts', 'service-debug.ts'].includes(name),
    )
    expect(groupFiles.length).toBeGreaterThan(0)
    const declared = new Set<string>()
    for (const file of groupFiles) {
      const text = readFileSync(join(endpointGroupsDir, file), 'utf8')
      for (const match of text.matchAll(/^\s{2}async ([a-zA-Z][A-Za-z0-9]*)\(/gm)) declared.add(match[1]!)
    }
    // 反空洞：确实扫到了端点方法（否则空集断言会假通过）
    expect(declared.size).toBeGreaterThan(0)
    const missing = [...declared].filter((name) => !baseOwn.has(name) || !VisualWorkflowApi.ENDPOINTS.has(name))
    expect(missing, `以下端点方法未登记进 ENDPOINT_NAMES（会被当未知端点 404）：${missing.join(', ')}`).toEqual([])
  })
})

describe('呈现语言判定（systemLanguage 能力缝）', () => {
  it('宿主未注入语言能力时按中文呈现（与插件默认中文界面一致）', async () => {
    const h = await makeHarness()
    expect(isChinesePresentation(h.host)).toBe(true)
    expect(presentationOf(h.host, '中', 'en')).toBe('中')
  })

  it('中文取 zh 分支；其他语言（含客户端未支持的语言）取 en 分支', async () => {
    const zh = await makeHarness({ systemLanguage: () => '中文' })
    const en = await makeHarness({ systemLanguage: () => 'English' })
    const other = await makeHarness({ systemLanguage: () => 'Español' })

    expect(presentationOf(zh.host, '中', 'en')).toBe('中')
    expect(presentationOf(en.host, '中', 'en')).toBe('en')
    expect(presentationOf(other.host, '中', 'en')).toBe('en')
  })
})
