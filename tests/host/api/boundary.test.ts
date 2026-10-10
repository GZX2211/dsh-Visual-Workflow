// tests/host/api/boundary.test.ts
//
// 端点白名单与分发（api/boundary.ts）：白名单与共享协议常量零漂移、
// 未知端点 404、原型链方法不可达，以及呈现语言能力缝的降级口径。

import { afterEach, describe, expect, it } from 'vitest'
import * as EP from '../../../src/host/shared/protocol.js'
import { VisualWorkflowApi } from '../../../src/host/api/index.js'
import { isChinesePresentation, presentationOf } from '../../../src/host/api/boundary.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('端点白名单与分发', () => {
  it('白名单与共享协议常量完全一致（零漂移）', () => {
    const expected = new Set<string>((Object.values(EP) as unknown[]).filter((v): v is string => typeof v === 'string'))
    expect(VisualWorkflowApi.ENDPOINTS.size).toBe(expected.size)
    for (const name of expected) expect(VisualWorkflowApi.ENDPOINTS.has(name)).toBe(true)
  })

  it('未知端点 404；原型链方法不可达', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('constructor', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('__proto__', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('noSuchEndpoint', {})).rejects.toMatchObject({ status: 404 })
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
