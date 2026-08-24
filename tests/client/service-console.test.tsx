// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/service-console.test.tsx
//
// 服务控制台（T-049）：状态/端口展示；启动/停止切换（crashed 可重启）；
// 运行中调试输入 → serviceDebug SSE 流式预览（打字机增量渲染）；
// 流中错误行 → [错误] 前缀输出；停止按钮中止请求。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ServiceConsole } from '../../src/client/components/service-console/ServiceConsole.js'
import { zh } from '../../src/client/i18n.js'
import type { ServiceState } from '../../src/host/shared/types.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
  vi.unstubAllGlobals()
})

function makeService(status: ServiceState['status'], port?: number): ServiceState {
  return {
    id: 'svc-1',
    sessionId: 's-1',
    name: '测试服务',
    description: '',
    revision: 1,
    nodes: [],
    lines: [],
    status,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...(port ? { port } : {}),
  } as ServiceState
}

function buttons(): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-service-console button')).map((item) => item.textContent ?? '')
}

/** 受控 textarea 输入（React value tracker 需要 native setter）。 */
function setTextarea(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 构造 SSE 响应（逐块下发）。 */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function renderConsole(service: ServiceState): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(
      React.createElement(ServiceConsole, {
        copy: zh,
        service,
        sessionId: 's-9',
        busy: false,
      }),
    )
  })
}

describe('服务控制台', () => {
  it('停止/崩溃：不渲染调试台（状态指示与启停在画布控制栏）', async () => {
    await renderConsole(makeService('stopped'))
    expect(document.querySelector('.wf-service-console')).toBeNull()
    await renderConsole(makeService('crashed'))
    expect(document.querySelector('.wf-service-console')).toBeNull()
  })

  it('运行中：仅渲染调试区（无状态/启停冗余控件）', async () => {
    await renderConsole(makeService('running', 7860))
    expect(document.querySelector('.wf-service-console__debug')).toBeTruthy()
    expect(buttons()).not.toContain(zh.startService)
    expect(buttons()).not.toContain(zh.stopService)
  })

  it('调试发送：SSE 增量追加到输出（打字机），结束后按钮恢复', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"delta":{"content":"你"}}\n\n',
      'data: {"delta":{"content":"好"}}\n\n',
      'data: [DONE]\n\n',
    ]))
    vi.stubGlobal('fetch', fetchMock)
    await renderConsole(makeService('running', 7860))

    const input = document.querySelector('.wf-service-console__input') as HTMLTextAreaElement
    await act(async () => {
      setTextarea(input, '测试问题')
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-service-console button')).find((item) => item.textContent === zh.serviceDebugSend)?.click()
    })

    // fetch 端点与 body 正确
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/visual-workflow/serviceDebug')
    expect(JSON.parse(String(init.body))).toEqual({
      args: { serviceId: 'svc-1', sessionId: 's-9', prompt: '测试问题' },
    })

    // SSE 增量渲染完成（打字机追加）
    const output = document.querySelector('.wf-service-console__output') as HTMLPreElement
    expect(output.textContent).toBe('你好')
    // 结束后恢复发送按钮
    expect(buttons()).toContain(zh.serviceDebugSend)
  })

  it('流中错误行：输出显示 [错误] 前缀', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"error":{"message":"服务超时"}}\n\n',
      'data: [DONE]\n\n',
    ])))
    await renderConsole(makeService('running', 7860))
    const input = document.querySelector('.wf-service-console__input') as HTMLTextAreaElement
    await act(async () => {
      setTextarea(input, 'hi')
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-service-console button')).find((item) => item.textContent === zh.serviceDebugSend)?.click()
    })
    const output = document.querySelector('.wf-service-console__output') as HTMLPreElement
    expect(output.textContent).toContain('[错误] 服务超时')
  })

  it('服务停止后：调试区消失（组件内部 effect 中止流）', async () => {
    await renderConsole(makeService('running', 7860))
    expect(document.querySelector('.wf-service-console__debug')).toBeTruthy()

    // 模拟服务状态变化（组件内部 effect 中止流）
    await act(async () => {
      root?.unmount()
      root = createRoot(container!)
      root.render(React.createElement(ServiceConsole, { copy: zh, service: makeService('stopped'), sessionId: 's-9', busy: false }))
    })
    expect(document.querySelector('.wf-service-console__debug')).toBeNull()
  })
})

