// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/node-forms.test.tsx
//
// 虚拟节点表单：引用主节点只读 + 显示名（label）写回补丁。
// 闸门退役后不再有角色勾选（data.role 已不属于节点契约）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ProxyForm } from '../../../../../src/client/components/panels/inspector/node-forms.js'
import { zh } from '../../../../../src/client/i18n.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
})

const copy = { ...zh, modeName: () => '标准' }

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

describe('虚拟节点表单（ProxyForm）', () => {
  it('不再渲染角色勾选（闸门退役）', async () => {
    await render(React.createElement(ProxyForm, {
      data: {}, copy, onPatch: () => {}, mainLabel: 'CEO',
    } as never))
    expect(container!.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('显示名输入写入 label（画布显示名）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: {}, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    const input = container!.querySelector('input[type="text"]') as HTMLInputElement
    await act(async () => {
      // React 受控输入必须走原型上的 value setter 再派发 input 事件，直接赋 value 不触发 onChange
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, '阶段复核')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(patches.at(-1)).toEqual({ label: '阶段复核' })
  })

  it('引用主节点只读展示（不可在补丁里改引用）', async () => {
    await render(React.createElement(ProxyForm, {
      data: {}, copy, onPatch: () => {}, mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain('CEO')
    expect(container!.textContent).toContain(String(zh.proxyReadonlyHint))
  })
})
