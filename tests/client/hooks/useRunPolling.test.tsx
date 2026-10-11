// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useRunPolling.test.tsx
//
// 运行状态轮询间隔：取自 host 下发的 runtimeConfig（runPollMs）；
// 下发失败 / 响应缺失 / 取值非法一律回退 600ms —— 保住既有节奏，轮询不停摆。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { EP } from '../../../src/client/lib/remote.js'
import { RUN_POLL_MS, resolveRunPollMs, useRunPolling } from '../../../src/client/hooks/useRunPolling.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'

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

const dispatch = () => {}

interface PollProbe {
  remote: RemoteFace
  /** 每轮 runStatus 调用的时刻（毫秒，假时钟）。 */
  statusAt: number[]
  /** runtimeConfig 下发请求次数。 */
  configCalls: number
}

/** 探针远端面：runtimeConfig 的响应可注入，runStatus 记录调用时刻。 */
function pollProbe(configReply: () => Promise<unknown>): PollProbe {
  const probe: PollProbe = {
    statusAt: [],
    configCalls: 0,
    remote: {
      call: async (endpoint: string): Promise<unknown> => {
        if (endpoint === EP.EP_RUNTIME_CONFIG) {
          probe.configCalls += 1
          return await configReply()
        }
        if (endpoint === EP.EP_RUN_STATUS) {
          probe.statusAt.push(Date.now())
          return { status: 'running' }
        }
        throw new Error(`意外端点：${endpoint}`)
      },
      stream: async () => {},
    },
  }
  return probe
}

/** 相邻两次调用间隔（用于读节奏，不受「重建轮询时的立即一轮」影响）。 */
function gapsOf(stamps: number[]): number[] {
  return stamps.slice(1).map((stamp, index) => stamp - stamps[index])
}

async function render(remote: RemoteFace): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness, { remote }))
  })
}

function Harness({ remote }: { remote: RemoteFace }): null {
  useRunPolling('session-1', 'run-1', dispatch, remote)
  return null
}

describe('useRunPolling 轮询间隔接入', () => {
  it('轮询间隔取自 host 下发值（runPollMs=250）', async () => {
    const probe = pollProbe(async () => ({ runPollMs: 250 }))

    await render(probe.remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(probe.configCalls).toBe(1)
    const steady = probe.statusAt.slice(-4)
    expect(steady).toHaveLength(4)
    expect(gapsOf(steady)).toEqual([250, 250, 250])
  })

  it('下发端点失败：回退 600ms（轮询不停摆）', async () => {
    const probe = pollProbe(async () => {
      throw Object.assign(new Error('unknown endpoint: runtimeConfig'), { status: 404 })
    })

    await render(probe.remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })

    expect(probe.configCalls).toBe(1)
    expect(probe.statusAt).toHaveLength(3)
    expect(gapsOf(probe.statusAt)).toEqual([RUN_POLL_MS, RUN_POLL_MS])
  })

  it('下发响应缺失 runPollMs：回退 600ms', async () => {
    const probe = pollProbe(async () => ({}))

    await render(probe.remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })

    expect(probe.configCalls).toBe(1)
    expect(gapsOf(probe.statusAt)).toEqual([RUN_POLL_MS, RUN_POLL_MS])
  })

  it('下发值只在挂载时取一次（不随轮询重复请求）', async () => {
    const probe = pollProbe(async () => ({ runPollMs: 250 }))

    await render(probe.remote)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })

    expect(probe.configCalls).toBe(1)
  })
})

describe('resolveRunPollMs 缺省回退', () => {
  it('缺省间隔本体为 600ms', () => {
    expect(RUN_POLL_MS).toBe(600)
  })

  it('缺失 / 形态非法 / 非正数一律回退 600ms', () => {
    expect(resolveRunPollMs(undefined)).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs(null)).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({})).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({ runPollMs: null })).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({ runPollMs: '250' })).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({ runPollMs: 0 })).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({ runPollMs: -1 })).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({ runPollMs: Number.NaN })).toBe(RUN_POLL_MS)
    expect(resolveRunPollMs({ runPollMs: Number.POSITIVE_INFINITY })).toBe(RUN_POLL_MS)
  })

  it('合法正数原样采用', () => {
    expect(resolveRunPollMs({ runPollMs: 250 })).toBe(250)
    expect(resolveRunPollMs({ runPollMs: 2000 })).toBe(2000)
  })
})
