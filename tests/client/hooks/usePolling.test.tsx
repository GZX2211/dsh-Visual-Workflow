// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/usePolling.test.tsx
//
// 轮询统一实现：in-flight 互斥（慢响应不堆积）、序号保护（重建后丢弃过期结果）、
// 卸载取消（在途请求中止，回调不再写状态）、单轮失败静默。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { usePolling } from '../../../src/client/hooks/usePolling.js'

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

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

describe('usePolling', () => {
  it('挂载即跑一轮，随后按间隔触发', async () => {
    const task = vi.fn(async () => {})
    function Harness() {
      usePolling(task, { intervalMs: 100 }, [])
      return null
    }
    await render(React.createElement(Harness))
    expect(task).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(task).toHaveBeenCalledTimes(4)
  })

  it('in-flight 互斥：上一轮未结束时不重入', async () => {
    let release: (() => void) | null = null
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    function Harness() {
      usePolling(task, { intervalMs: 100 }, [])
      return null
    }
    await render(React.createElement(Harness))
    expect(task).toHaveBeenCalledTimes(1)

    // 首轮悬挂期间推进多轮：不得重入
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(task).toHaveBeenCalledTimes(1)

    // 释放首轮后，下一轮可正常发起
    await act(async () => { release?.() })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('序号保护：deps 重建后，旧一轮的结果判定为过期（isCurrent 为 false）', async () => {
    const results: boolean[] = []
    const resolvers: Array<() => void> = []
    function Harness({ epoch }: { epoch: string }) {
      usePolling(async ({ isCurrent }) => {
        await new Promise<void>((resolve) => { resolvers.push(resolve) })
        results.push(isCurrent())
      }, { intervalMs: 100 }, [epoch])
      return null
    }
    await render(React.createElement(Harness, { epoch: 'a' }))
    // 重建（epoch 变化）→ 旧一轮序号失效，同时启动新一轮
    await act(async () => { root!.render(React.createElement(Harness, { epoch: 'b' })) })
    expect(resolvers).toHaveLength(2)

    // 旧一轮此刻返回：必须被判定为过期（不消费其结果）
    await act(async () => { resolvers[0](); await vi.advanceTimersByTimeAsync(0) })
    expect(results).toEqual([false])

    // 新一轮返回：正常消费
    await act(async () => { resolvers[1](); await vi.advanceTimersByTimeAsync(0) })
    expect(results).toEqual([false, true])
  })

  it('卸载：中止在途请求（谁创建谁释放）', async () => {
    let captured: AbortSignal | null = null
    function Harness() {
      usePolling(async ({ signal }) => {
        captured = signal
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve()) })
      }, { intervalMs: 100 }, [])
      return null
    }
    await render(React.createElement(Harness))
    await act(async () => { root?.unmount(); root = null })
    expect((captured as AbortSignal | null)?.aborted).toBe(true)
  })

  it('单轮失败静默：不抛出到渲染层，下一轮继续', async () => {
    const task = vi.fn(async () => { throw new Error('boom') })
    function Harness() {
      usePolling(task, { intervalMs: 100 }, [])
      return null
    }
    await render(React.createElement(Harness))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('enabled=false：不发起任何请求', async () => {
    const task = vi.fn(async () => {})
    function Harness() {
      usePolling(task, { intervalMs: 100, enabled: false }, [])
      return null
    }
    await render(React.createElement(Harness))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(task).not.toHaveBeenCalled()
  })

  it('上下文携带轮询专用超时预算（悬挂请求尽快释放 in-flight 位）', async () => {
    const timeouts: number[] = []
    function Harness() {
      usePolling(async ({ timeoutMs }) => { timeouts.push(timeoutMs) }, { intervalMs: 100 }, [])
      return null
    }
    await render(React.createElement(Harness))
    expect(timeouts).toHaveLength(1)
    expect(timeouts[0]).toBeGreaterThan(0)
    expect(timeouts[0]).toBeLessThanOrEqual(10_000)
  })
})
