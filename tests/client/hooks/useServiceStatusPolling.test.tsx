// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useServiceStatusPolling.test.tsx
//
// 服务状态轮询：把宿主侧的服务运行事实（崩溃/被回收）拉回界面投影；
// 只在状态/端口变化时落库；仅模式二且存在非停止服务时轮询。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import {
  useServiceStatusPolling, trackedServicesOf, trackedServicesSignature, SERVICE_STATUS_POLL_MS,
} from '../../../src/client/hooks/useServiceStatusPolling.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { StudioAction, StudioState } from '../../../src/client/studio/studio-state.js'
import type { ServiceState } from '../../../src/host/shared/types.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

function serviceOf(id: string, status: ServiceState['status'], port?: number): ServiceState {
  return {
    id, sessionId: 's-1', name: id, description: '', revision: 1, nodes: [], lines: [], status,
    createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
    ...(port ? { port } : {}),
  } as ServiceState
}

function stateOf(mode: 'mode1' | 'mode2', services: ServiceState[]): StudioState {
  return { mode, services } as unknown as StudioState
}

function remoteReturning(result: unknown): RemoteFace {
  return { call: vi.fn(async () => result), stream: vi.fn(async () => undefined) } as unknown as RemoteFace
}

async function render(state: StudioState, dispatch: (action: StudioAction) => void, remote: RemoteFace): Promise<void> {
  function Harness() {
    useServiceStatusPolling(state, dispatch, remote)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  // 挂载即跑的首次轮询完成（受控 Promise 解析）
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe('useServiceStatusPolling', () => {
  it('宿主侧状态变化（运行中 → 崩溃）→ dispatch SERVICE_UPDATED', async () => {
    const dispatch = vi.fn()
    const crashed = serviceOf('svc-1', 'crashed')
    await render(stateOf('mode2', [serviceOf('svc-1', 'running', 7860)]), dispatch, remoteReturning(crashed))

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SERVICE_UPDATED', service: crashed })
  })

  it('状态与端口都未变化 → 不落库（避免每轮重渲染）', async () => {
    const dispatch = vi.fn()
    await render(stateOf('mode2', [serviceOf('svc-1', 'running', 7860)]), dispatch, remoteReturning(serviceOf('svc-1', 'running', 7860)))
    await act(async () => { await vi.advanceTimersByTimeAsync(SERVICE_STATUS_POLL_MS * 2) })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('模式一 → 不发起服务状态请求', async () => {
    const dispatch = vi.fn()
    const remote = remoteReturning(serviceOf('svc-1', 'running'))
    await render(stateOf('mode1', [serviceOf('svc-1', 'running')]), dispatch, remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(SERVICE_STATUS_POLL_MS * 2) })
    expect(remote.call).not.toHaveBeenCalled()
  })

  it('仅停止态服务 → 不轮询（无进程可查）', async () => {
    const dispatch = vi.fn()
    const remote = remoteReturning(serviceOf('svc-1', 'stopped'))
    await render(stateOf('mode2', [serviceOf('svc-1', 'stopped')]), dispatch, remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(SERVICE_STATUS_POLL_MS * 2) })
    expect(remote.call).not.toHaveBeenCalled()
  })

  it('查询失败静默：不落库、不抛出（下一轮重试）', async () => {
    const dispatch = vi.fn()
    const remote = { call: vi.fn(async () => { throw new Error('boom') }), stream: vi.fn(async () => undefined) } as unknown as RemoteFace
    await render(stateOf('mode2', [serviceOf('svc-1', 'running')]), dispatch, remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(SERVICE_STATUS_POLL_MS) })
    expect(dispatch).not.toHaveBeenCalled()
    expect(remote.call).toHaveBeenCalledTimes(2)
  })
})

describe('跟踪集合与签名（纯函数）', () => {
  it('trackedServicesOf：排除 stopped', () => {
    expect(trackedServicesOf([serviceOf('a', 'running'), serviceOf('b', 'stopped'), serviceOf('c', 'crashed')]).map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('trackedServicesSignature：状态或端口变化即变化；与顺序无关', () => {
    const a = serviceOf('a', 'running', 1)
    const b = serviceOf('b', 'crashed')
    expect(trackedServicesSignature([a, b])).toBe(trackedServicesSignature([b, a]))
    expect(trackedServicesSignature([a, b])).not.toBe(trackedServicesSignature([a, { ...b, status: 'running' } as ServiceState]))
    expect(trackedServicesSignature([a, b])).not.toBe(trackedServicesSignature([{ ...a, port: 2 } as ServiceState, b]))
  })
})
