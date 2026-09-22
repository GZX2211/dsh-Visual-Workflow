// tests/host/api/boundary.test.ts
//
// 端点白名单与分发（api/boundary.ts）：白名单与共享协议常量零漂移、
// 未知端点 404、原型链方法不可达。

import { afterEach, describe, expect, it } from 'vitest'
import * as EP from '../../../src/host/shared/protocol.js'
import { VisualWorkflowApi } from '../../../src/host/api/index.js'
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
