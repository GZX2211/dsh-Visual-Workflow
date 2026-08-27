// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/remote.test.ts
//
// remoteCall 单测：成功响应/非 ok 响应/网络失败/非 JSON 响应/端点名与协议常量零漂移。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteCall, EP } from '../../src/client/lib/remote.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('remoteCall', () => {
  it('成功：返回 payload.value', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { id: 'x' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    const value = await remoteCall('listWorkflows', { sessionId: 's-1' })
    expect(value).toEqual({ id: 'x' })
  })

  it('请求形态：POST /visual-workflow/<endpoint> + body { args }', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await remoteCall('run', { sessionId: 's-1', flowId: 'f-1' })
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const [url, init] = call
    expect(url).toBe('/visual-workflow/run')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ args: { sessionId: 's-1', flowId: 'f-1' } })
  })

  it('HTTP 错误：抛出后端 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: '工作流不存在' },
    }), { status: 404 })))
    await expect(remoteCall('getWorkflow')).rejects.toThrow('工作流不存在')
  })

  it('错误：抛出 Error 携带后端稳定 code（Bug 20 契约，调用方可按码分支）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: '资源在加载后被修改', code: 'FLOW_REVISION_CONFLICT' },
    }), { status: 409 })))
    const error = await remoteCall('putWorkflow', { sessionId: 's-1' }).then(
      () => null,
      (err: unknown) => err as Error & { code?: string },
    )
    expect(error).not.toBeNull()
    expect(error!.message).toBe('资源在加载后被修改')
    expect(error!.code).toBe('FLOW_REVISION_CONFLICT')
  })

  it('非 JSON 响应：兜底文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    await expect(remoteCall('x')).rejects.toThrow('工作流服务错误')
  })

  it('网络失败：连接错误文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(remoteCall('x')).rejects.toThrow('无法连接工作流服务')
  })

  it('端点常量与后端协议表零漂移（EP 命名空间导出）', () => {
    expect(EP.EP_RUN).toBe('run')
    expect(EP.EP_LIST_WORKFLOWS).toBe('listWorkflows')
    expect(EP.EP_SERVICE_START).toBe('serviceStart')
    expect(EP.EP_PUT_TEMPLATE).toBe('putTemplate')
  })
})
