// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/text-expand.test.tsx
//
// 属性栏文本域扩展编辑（用户批注）：所有多行文本域右下角提供展开按钮，
// 展开后在画布区域的可编辑大文本域中编辑，右上角“收起”按钮 / Esc 返回属性栏。
// 本文件锁定组件行为；扩展层在真实布局中的挂载位置与自动收起由 Studio 集成用例覆盖。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import {
  ExpandableTextArea,
  TextExpandOverlay,
  TextExpandProvider,
  type TextExpandRequest,
} from '../../../../../src/client/components/panels/inspector/text-expand.js'
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

/** 受控 textarea 输入（React 受控输入必须走原型 setter 再派发 input 事件）。 */
function typeInto(input: HTMLTextAreaElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setValue.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 独立使用场景：只有文本域、没有扩展宿主。 */
async function renderExpandableOnly(onChange: (value: string) => void = () => {}): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(ExpandableTextArea, {
      label: 'System Prompt',
      value: '初始内容',
      placeholder: '提示',
      onChange,
    }))
  })
}

/** 带扩展宿主的场景：展开层与宿主由同一个父组件持有（与真实布局层一致）。 */
function ExpandHarness({ initial, onChange }: { initial: string; onChange(value: string): void }) {
  const [request, setRequest] = useState<TextExpandRequest | null>(null)
  const host = useMemo(() => ({ open: setRequest, expandLabel: zh.textExpand }), [])
  return (
    <>
      <TextExpandProvider host={host}>
        <ExpandableTextArea label="System Prompt" value={initial} placeholder="提示" onChange={onChange} />
      </TextExpandProvider>
      {request ? <TextExpandOverlay copy={zh} request={request} onClose={() => setRequest(null)} /> : null}
    </>
  )
}

async function renderHarness(initial: string, onChange: (value: string) => void): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(ExpandHarness, { initial, onChange }))
  })
}

describe('可展开文本域', () => {
  it('展开按钮：文本域右下角渲染展开入口，点击后出现带字段标题与当前值的编辑层', async () => {
    await renderHarness('初始内容', () => {})

    const expand = container!.querySelector<HTMLButtonElement>('.wf-textarea__expand')
    expect(expand).toBeTruthy()
    expect(expand!.getAttribute('aria-label')).toBe(zh.textExpand)
    expect(container!.querySelector('.wf-text-expand')).toBeNull()

    await act(async () => { expand!.click() })

    const overlay = container!.querySelector('.wf-text-expand')
    expect(overlay).toBeTruthy()
    expect(overlay!.querySelector('.wf-text-expand__title')?.textContent).toBe('System Prompt')
    expect(overlay!.querySelector<HTMLTextAreaElement>('.wf-text-expand__input')?.value).toBe('初始内容')
  })

  it('编辑层可编辑：输入写回业务 onChange，并同步更新编辑层显示', async () => {
    const changes: string[] = []
    await renderHarness('初始内容', (value) => changes.push(value))
    await act(async () => { container!.querySelector<HTMLButtonElement>('.wf-textarea__expand')!.click() })

    const input = container!.querySelector<HTMLTextAreaElement>('.wf-text-expand__input')!
    await act(async () => { typeInto(input, '扩展后的内容') })

    expect(changes.at(-1)).toBe('扩展后的内容')
    expect(input.value).toBe('扩展后的内容')
  })

  it('右上角「收起」按钮：点击后隐藏编辑层并回到属性栏', async () => {
    await renderHarness('初始内容', () => {})
    await act(async () => { container!.querySelector<HTMLButtonElement>('.wf-textarea__expand')!.click() })

    const collapse = container!.querySelector<HTMLButtonElement>('.wf-text-expand__collapse')!
    expect(collapse.getAttribute('aria-label')).toBe(zh.textExpandCollapse)
    await act(async () => { collapse.click() })

    expect(container!.querySelector('.wf-text-expand')).toBeNull()
    expect(container!.querySelector('.wf-textarea__expand')).toBeTruthy()
  })

  it('Esc：同样收起编辑层', async () => {
    await renderHarness('初始内容', () => {})
    await act(async () => { container!.querySelector<HTMLButtonElement>('.wf-textarea__expand')!.click() })
    expect(container!.querySelector('.wf-text-expand')).toBeTruthy()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(container!.querySelector('.wf-text-expand')).toBeNull()
  })

  it('切换到另一个字段：编辑层重置为该字段的值', async () => {
    const requestA: TextExpandRequest = { key: 'a', label: '字段 A', value: 'A 值', onChange: () => {} }
    const requestB: TextExpandRequest = { key: 'b', label: '字段 B', value: 'B 值', onChange: () => {} }
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(TextExpandOverlay, { copy: zh, request: requestA, onClose: () => {} }))
    })
    await act(async () => {
      root!.render(React.createElement(TextExpandOverlay, { copy: zh, request: requestB, onClose: () => {} }))
    })

    expect(container!.querySelector<HTMLTextAreaElement>('.wf-text-expand__input')?.value).toBe('B 值')
    expect(container!.querySelector('.wf-text-expand__title')?.textContent).toBe('字段 B')
  })

  it('没有扩展宿主时退化为普通文本域（不渲染不可用的展开按钮）', async () => {
    const onChange = vi.fn()
    await renderExpandableOnly(onChange)
    const textarea = container!.querySelector('textarea')!
    expect(textarea.value).toBe('初始内容')
    expect(container!.querySelector('.wf-textarea__expand')).toBeNull()
  })
})
