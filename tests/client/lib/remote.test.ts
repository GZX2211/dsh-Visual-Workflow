// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/lib/remote.test.ts
//
// remoteCall 单测：成功响应/非 ok 响应/网络失败/非 JSON 响应/端点名与协议常量零漂移/
// 超时与主动取消（失败语义显式）/ 乐观锁冲突判定。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  remoteCall, streamCall, EP, isRevisionConflict, DEFAULT_REMOTE_TIMEOUT_MS, POLL_REMOTE_TIMEOUT_MS,
  REMOTE_TIMEOUT_CODE, REMOTE_CONNECTION_CODE, REMOTE_HTTP_STATUS_CODE, REMOTE_EMPTY_STREAM_CODE,
  type RemoteError,
} from '../../../src/client/lib/remote.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** protocol.ts 原文中声明的端点常量名（与运行期导出集合同一本体，非测试内副本）。 */
function declaredEndpointNames(): string[] {
  const protocolSource = readFileSync(resolve(root, 'src/host/shared/protocol.ts'), 'utf8')
  return [...protocolSource.matchAll(/^export const (EP_[A-Z0-9_]+)\s*=/gm)].map((match) => match[1])
}

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

  it('非 JSON 响应：返回可本地化的 HTTP 状态失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    await expect(remoteCall('x')).rejects.toMatchObject({
      code: REMOTE_HTTP_STATUS_CODE,
      transportKind: 'http',
      status: 500,
    })
  })

  it('网络失败：保留稳定连接码与底层诊断', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(remoteCall('x')).rejects.toMatchObject({
      code: REMOTE_CONNECTION_CODE,
      transportKind: 'connection',
      detail: 'fetch failed',
    })
  })

  it('remote.ts 再导出 protocol.ts 的全部 EP_* 端点常量（零漂移）', () => {
    const declared = declaredEndpointNames()
    // 防提取器失效：protocol.ts 本体必须真的解析出全部端点常量。
    expect(declared.length).toBeGreaterThan(30)
    // 比较对象两侧都是运行期/源码本体：一侧是 remote.ts 再导出的模块命名空间，
    // 另一侧是 protocol.ts 声明的常量名，都没有测试内硬编码副本。
    const exportedEndpoints = Object.keys(EP).filter((name) => name.startsWith('EP_')).sort()
    expect(exportedEndpoints).toEqual([...declared].sort())
    for (const name of declared) {
      expect(typeof (EP as unknown as Record<string, unknown>)[name]).toBe('string')
    }
  })

  it('remote.ts 不另建端点字面量本体（只经 protocol.ts 引用）', () => {
    const remoteSource = readFileSync(resolve(root, 'src/client/lib/remote.ts'), 'utf8')
    expect(remoteSource).toContain("import * as EP from '../../host/shared/protocol.js'")
    // 本地再定义 EP_* 常量即为「第二份端点本体」，必须失败。
    expect(remoteSource).not.toMatch(/^(?:export )?const EP_[A-Z0-9_]+\s*=/m)
    expect(remoteSource).toMatch(/^export \{ EP \}$/m)
  })
})

describe('streamCall fallback errors', () => {
  it('test_empty_success_response_uses_a_stable_localizable_failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(streamCall('debug', {}, () => {})).rejects.toMatchObject({
      code: REMOTE_EMPTY_STREAM_CODE,
      transportKind: 'emptyStream',
    })
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
    const settled = pending.then(() => null, (error: unknown) => error as RemoteError)
    await vi.advanceTimersByTimeAsync(50)
    const error = await settled
    expect(error).not.toBeNull()
    expect(error!.code).toBe(REMOTE_TIMEOUT_CODE)
    expect(error!.endpoint).toBe('slowEndpoint')
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
    // 该码的跨层约定（命名/前缀族）由 tests/contract/client-boundary.test.ts 从 protocol.ts 本体锁定，此处只验行为。
    expect(isRevisionConflict(Object.assign(new Error('conflict'), { code: EP.ERR_REVISION_CONFLICT }))).toBe(true)
    expect(isRevisionConflict(Object.assign(new Error('other'), { code: 'WF_LOCKED' }))).toBe(false)
    expect(isRevisionConflict(new Error('plain'))).toBe(false)
    expect(isRevisionConflict(null)).toBe(false)
  })
})
