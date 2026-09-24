// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/service-console/ServiceConsole.test.tsx
//
// 服务调试台（纯表现层，T-049）：仅运行中渲染；调试输入 → 注入的调试面
// （网络与 SSE 归 useServiceDebugStream，其行为见 tests/client/hooks/useServiceDebugStream.test.tsx）；
// 进行中显示停止按钮；输出为空时显示引导文案。

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ServiceConsole } from '../../../../src/client/components/service-console/ServiceConsole.js'
import type { ServiceDebugFace } from '../../../../src/client/hooks/useServiceDebugStream.js'
import { zh } from '../../../../src/client/i18n.js'
import type { ServiceState } from '../../../../src/host/shared/types.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
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

function makeDebug(overrides: Partial<ServiceDebugFace> = {}): ServiceDebugFace {
  return { output: '', streaming: false, send: vi.fn(), stop: vi.fn(), ...overrides }
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

async function renderConsole(service: ServiceState, debug: ServiceDebugFace = makeDebug(), busy = false): Promise<void> {
  await act(async () => {
    root?.unmount()
    root = createRoot(container!)
    root.render(React.createElement(ServiceConsole, { copy: zh, service, busy, debug }))
  })
}

describe('服务控制台（表现层）', () => {
  it('停止/崩溃：不渲染调试台（状态指示与启停在画布控制栏）', async () => {
    await renderConsole(makeService('stopped'))
    expect(document.querySelector('.wf-service-console')).toBeNull()
    await renderConsole(makeService('crashed'))
    expect(document.querySelector('.wf-service-console')).toBeNull()
  })

  it('运行中：仅渲染调试区（无状态/启停冗余控件）', async () => {
    await renderConsole(makeService('running', 7860))
    expect(document.querySelector('.wf-service-console__debug')).not.toBeNull()
    expect(buttons()).not.toContain(zh.startService)
    expect(buttons()).not.toContain(zh.stopService)
  })

  it('空输出显示引导文案；有输出则显示流式内容', async () => {
    await renderConsole(makeService('running'))
    const output = document.querySelector('.wf-service-console__output') as HTMLPreElement
    expect(output.textContent).toBe(zh.serviceDebugEmpty)

    await renderConsole(makeService('running'), makeDebug({ output: '你好' }))
    expect((document.querySelector('.wf-service-console__output') as HTMLPreElement).textContent).toBe('你好')
  })

  it('点击发送：把当前输入交给调试面（组件不自建网络调用）', async () => {
    const debug = makeDebug()
    await renderConsole(makeService('running'), debug)
    const input = document.querySelector('.wf-service-console__input') as HTMLTextAreaElement
    await act(async () => { setTextarea(input, '测试问题') })

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-service-console button'))
        .find((item) => item.textContent === zh.serviceDebugSend)?.click()
    })

    expect(debug.send).toHaveBeenCalledWith('测试问题')
  })

  it('Enter 发送、Shift+Enter 换行', async () => {
    const debug = makeDebug()
    await renderConsole(makeService('running'), debug)
    const input = document.querySelector('.wf-service-console__input') as HTMLTextAreaElement
    await act(async () => { setTextarea(input, '问题') })

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    })
    expect(debug.send).not.toHaveBeenCalled()

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(debug.send).toHaveBeenCalledWith('问题')
  })

  it('进行中：显示停止按钮并调用调试面 stop', async () => {
    const debug = makeDebug({ streaming: true })
    await renderConsole(makeService('running'), debug)

    expect(buttons()).toContain(zh.serviceDebugStop)
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-service-console button'))
        .find((item) => item.textContent === zh.serviceDebugStop)?.click()
    })
    expect(debug.stop).toHaveBeenCalled()
  })

  it('输入为空时发送按钮禁用', async () => {
    await renderConsole(makeService('running'))
    const send = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-service-console button'))
      .find((item) => item.textContent === zh.serviceDebugSend) as HTMLButtonElement
    expect(send.disabled).toBe(true)
  })
})
