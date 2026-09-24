// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useServiceDebugStream.test.tsx
//
// 服务调试流 hook：SSE 增量累积（打字机）、错误行前缀、主动停止中止、服务非运行态拒绝发送、
// 卸载中止在途流。网络访问经注入的 RemoteFace（测试用可控 stream 实现隔离边界）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useServiceDebugStream, type ServiceDebugFace, type ServiceDebugOptions } from '../../../src/client/hooks/useServiceDebugStream.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'

let container: HTMLDivElement | null = null
let root: Root | null = null
let face: ServiceDebugFace | null = null

const OPTIONS: ServiceDebugOptions = {
  serviceId: 'svc-1',
  sessionId: 's-9',
  enabled: true,
  errorPrefix: '[错误] ',
}

function Harness({ remote, options }: { remote: RemoteFace; options: ServiceDebugOptions }) {
  face = useServiceDebugStream(remote, options)
  return null
}

/** 最小 RemoteFace：call 不用；stream 由每个用例注入。 */
function remoteWith(stream: RemoteFace['stream']): RemoteFace {
  return { call: vi.fn(async () => null), stream }
}

async function render(remote: RemoteFace, options: ServiceDebugOptions = OPTIONS): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness, { remote, options }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  face = null
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
})

describe('useServiceDebugStream', () => {
  it('发送：SSE 增量累积为完整输出，结束后 streaming 复位', async () => {
    const stream = vi.fn(async (_endpoint, _args, onLine: (line: string) => void) => {
      onLine('data: {"choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}')
      onLine('data: {"choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}')
      onLine('data: [DONE]')
      onLine('')
    })
    await render(remoteWith(stream))

    await act(async () => { face!.send('测试问题') })

    expect(stream).toHaveBeenCalledWith('serviceDebug', { serviceId: 'svc-1', sessionId: 's-9', prompt: '测试问题' }, expect.any(Function), expect.any(AbortSignal))
    expect(face!.output).toBe('你好')
    expect(face!.streaming).toBe(false)
  })

  it('流内错误行：输出带词典注入的错误前缀', async () => {
    const stream = vi.fn(async (_endpoint, _args, onLine: (line: string) => void) => {
      onLine('data: {"error":{"message":"服务超时"}}')
      onLine('data: [DONE]')
    })
    await render(remoteWith(stream))

    await act(async () => { face!.send('hi') })

    expect(face!.output).toBe('[错误] 服务超时')
  })

  it('传输失败：错误消息进入输出（不抛出到组件）', async () => {
    const stream = vi.fn(async () => { throw new Error('连接中断') })
    await render(remoteWith(stream))

    await act(async () => { face!.send('hi') })

    expect(face!.output).toBe('[错误] 连接中断')
    expect(face!.streaming).toBe(false)
  })

  it('stop：中止在途流的 AbortSignal，输出保留', async () => {
    let captured: AbortSignal | null = null
    const stream = vi.fn(async (_endpoint, _args, onLine: (line: string) => void, signal?: AbortSignal) => {
      captured = signal ?? null
      onLine('data: {"choices":[{"index":0,"delta":{"content":"部分"},"finish_reason":null}]}')
      // 模拟长连接：等待中止
      await new Promise<void>((resolve) => { signal?.addEventListener('abort', () => resolve()) })
    })
    await render(remoteWith(stream))

    await act(async () => { face!.send('hi'); face!.stop() })

    expect(captured).not.toBeNull()
    expect((captured as AbortSignal | null)!.aborted).toBe(true)
    expect(face!.output).toBe('部分')
  })

  it('服务非运行态（enabled=false）：拒绝发送，不发请求', async () => {
    const stream = vi.fn(async () => undefined)
    await render(remoteWith(stream), { ...OPTIONS, enabled: false })

    await act(async () => { face!.send('hi') })

    expect(stream).not.toHaveBeenCalled()
    expect(face!.output).toBe('')
  })

  it('空问题不发送', async () => {
    const stream = vi.fn(async () => undefined)
    await render(remoteWith(stream))

    await act(async () => { face!.send('   ') })

    expect(stream).not.toHaveBeenCalled()
  })

  it('卸载：中止在途流（谁创建谁释放）', async () => {
    let captured: AbortSignal | null = null
    const stream = vi.fn(async (_endpoint, _args, _onLine: (line: string) => void, signal?: AbortSignal) => {
      captured = signal ?? null
      await new Promise<void>((resolve) => { signal?.addEventListener('abort', () => resolve()) })
    })
    await render(remoteWith(stream))
    await act(async () => { face!.send('hi') })

    await act(async () => { root?.unmount(); root = null })

    expect((captured as AbortSignal | null)!.aborted).toBe(true)
  })
})
