// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/node-forms.test.tsx
//
// 虚拟节点表单（P4 闸门可视化）：默认「普通执行入口」→ 勾选写 role=milestone；
// 已是闸门时勾选态为真，取消勾选写 role=null 退回 executor；显示名输入写 label。

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

describe('P4 虚拟节点表单（ProxyForm，闸门可视化）', () => {
  it('默认角色为「普通执行入口」；勾选后补丁 role=milestone', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: {}, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain(zh.proxyRoleExecutor)
    const box = container!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => { box.click() })
    expect(patches).toEqual([{ role: 'milestone' }])
  })

  it('已是闸门时勾选态为真；取消勾选写 role=null（退回 executor）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: { role: 'milestone' }, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain(zh.proxyRoleMilestone)
    const box = container!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    expect(box.checked).toBe(true)
    await act(async () => { box.click() })
    expect(patches).toEqual([{ role: null }])
  })

  it('显示名输入写入 label（画布显示名）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: { role: 'milestone' }, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    const input = container!.querySelector('input[type="text"]') as HTMLInputElement
    await act(async () => {
      // React 受控输入必须走原型上的 value setter 再派发 input 事件，直接赋 value 不触发 onChange
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, '里程碑①：方案评审')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(patches.at(-1)).toEqual({ label: '里程碑①：方案评审' })
  })
})
