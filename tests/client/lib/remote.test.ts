// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/lib/remote.test.ts
//
// remoteCall 单测：成功响应/非 ok 响应/网络失败/非 JSON 响应/端点名与协议常量零漂移/
// 超时与主动取消（失败语义显式）/ 乐观锁冲突判定。

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  remoteCall, EP, isRevisionConflict, DEFAULT_REMOTE_TIMEOUT_MS, POLL_REMOTE_TIMEOUT_MS, REMOTE_TIMEOUT_CODE,
} from '../../../src/client/lib/remote.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

describe('remoteCall 超时与取消（失败语义显式）', () => {
  /** 永不 resolve 的 fetch；收到 abort 时按浏览器语义抛 AbortError。 */
  function hangingFetch(): void {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
  }

  it('超时：抛出携带 REMOTE_TIMEOUT 稳定码的错误（不再永久悬挂）', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const pending = remoteCall('slowEndpoint', {}, { timeoutMs: 50 })
    const settled = pending.then(() => null, (error: unknown) => error as Error & { code?: string })
    await vi.advanceTimersByTimeAsync(50)
    const error = await settled
    expect(error).not.toBeNull()
    expect(error!.code).toBe(REMOTE_TIMEOUT_CODE)
    expect(error!.message).toContain('slowEndpoint')
  })

  it('主动取消：原样抛出 AbortError（调用方按取消语义静默处理，不伪装成连接失败）', async () => {
    hangingFetch()
    const controller = new AbortController()
    const pending = remoteCall('slowEndpoint', {}, { signal: controller.signal })
    const settled = pending.then(() => null, (error: unknown) => error as Error)
    controller.abort()
    const error = await settled
    expect(error?.name).toBe('AbortError')
    expect(error?.message).not.toContain('无法连接工作流服务')
  })

  it('timeoutMs=0：不设超时（请求仍可被外部取消）', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const controller = new AbortController()
    const pending = remoteCall('slowEndpoint', {}, { timeoutMs: 0, signal: controller.signal })
    const settled = pending.then(() => null, (error: unknown) => error as Error)
    await vi.advanceTimersByTimeAsync(DEFAULT_REMOTE_TIMEOUT_MS * 2)
    controller.abort()
    expect((await settled)?.name).toBe('AbortError')
  })

  it('轮询超时显著短于默认超时（悬挂请求尽快释放 in-flight 位）', () => {
    expect(POLL_REMOTE_TIMEOUT_MS).toBeLessThan(DEFAULT_REMOTE_TIMEOUT_MS)
  })
})

describe('isRevisionConflict（乐观锁冲突判定）', () => {
  it('后端稳定码 ERR_REVISION_CONFLICT → true；其他码/无码 → false', () => {
    expect(EP.ERR_REVISION_CONFLICT).toBe('FLOW_REVISION_CONFLICT')
    expect(isRevisionConflict(Object.assign(new Error('conflict'), { code: EP.ERR_REVISION_CONFLICT }))).toBe(true)
    expect(isRevisionConflict(Object.assign(new Error('other'), { code: 'WF_LOCKED' }))).toBe(false)
    expect(isRevisionConflict(new Error('plain'))).toBe(false)
    expect(isRevisionConflict(null)).toBe(false)
  })
})
