// tests/host/api/http.test.ts
//
// GUI API 传输层基础件的**策略面**单测（K2 用户裁决）：
//   - 按端点的请求体上限分级（无参端点不再被强制收满 64MB；上限差异有意义，不统一）；
//   - 来源校验（Origin / Sec-Fetch-Site）：只拦浏览器跨站发起的请求。
// 读体/写出的通用语义见 tests/host/http-io.test.ts。

import { describe, expect, it } from 'vitest'
import { GUI_BODY_LIMIT, guiBodyLimitOf, guiRequestTrust } from '../../../src/host/api/http.js'

describe('按端点的请求体上限（K2）', () => {
  it('四级分级：无参 16KB / 常规 2MB / 文档 16MB / 二进制 64MB', () => {
    expect(GUI_BODY_LIMIT).toMatchObject({
      argsFree: 16 * 1024,
      normal: 2 * 1024 * 1024,
      document: 16 * 1024 * 1024,
      binary: 64 * 1024 * 1024,
    })
  })

  it('无参端点取无参档（列表/状态类端点不再允许 64MB）', () => {
    for (const endpoint of ['presets', 'tools', 'models', 'toolCombos', 'mcpList', 'toolSwitches', 'schedulerTasks']) {
      expect(guiBodyLimitOf(endpoint), endpoint).toBe(GUI_BODY_LIMIT.argsFree)
    }
  })

  it('整份文档端点取文档档，二进制/导入端点取 64MB 档（差异保留，不统一）', () => {
    expect(guiBodyLimitOf('putWorkflow')).toBe(GUI_BODY_LIMIT.document)
    expect(guiBodyLimitOf('putFlowTemplate')).toBe(GUI_BODY_LIMIT.document)
    expect(guiBodyLimitOf('saveAssetVersion')).toBe(GUI_BODY_LIMIT.document)
    expect(guiBodyLimitOf('fileUpload')).toBe(GUI_BODY_LIMIT.binary)
    expect(guiBodyLimitOf('importWorkflow')).toBe(GUI_BODY_LIMIT.binary)
  })

  it('短参数端点与未知端点取常规档', () => {
    expect(guiBodyLimitOf('listWorkflows')).toBe(GUI_BODY_LIMIT.normal)
    expect(guiBodyLimitOf('runStop')).toBe(GUI_BODY_LIMIT.normal)
    expect(guiBodyLimitOf('nope')).toBe(GUI_BODY_LIMIT.normal)
  })
})

describe('来源校验（K2：仅本机可信）', () => {
  it('无 Origin / Sec-Fetch-Site（curl 等本机客户端）放行', () => {
    expect(guiRequestTrust({})).toEqual({ ok: true })
    expect(guiRequestTrust(undefined)).toEqual({ ok: true })
  })

  it('浏览器同源请求（Sec-Fetch-Site: same-origin / none）放行', () => {
    expect(guiRequestTrust({ 'sec-fetch-site': 'same-origin' })).toEqual({ ok: true })
    expect(guiRequestTrust({ 'sec-fetch-site': 'none' })).toEqual({ ok: true })
  })

  it('跨站与同站跨端口（cross-site / same-site）一律拒绝', () => {
    expect(guiRequestTrust({ 'sec-fetch-site': 'cross-site' }).ok).toBe(false)
    expect(guiRequestTrust({ 'sec-fetch-site': 'same-site' }).ok).toBe(false)
  })

  it('Origin 与 Host 一致放行；不一致拒绝（含 Origin: null）', () => {
    expect(guiRequestTrust({ origin: 'http://127.0.0.1:19387', host: '127.0.0.1:19387' })).toEqual({ ok: true })
    expect(guiRequestTrust({ origin: 'https://evil.example', host: '127.0.0.1:19387' }).ok).toBe(false)
    expect(guiRequestTrust({ origin: 'null' }).ok).toBe(false)
  })

  it('本地开发代理（回环 Origin + 被改写的 Host）放行', () => {
    expect(guiRequestTrust({ origin: 'http://localhost:5173', host: '127.0.0.1:19387' })).toEqual({ ok: true })
  })
})
