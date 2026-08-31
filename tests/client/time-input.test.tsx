// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/time-input.test.tsx
//
// 自定义时间输入：文本按位（1125 → 11:25）、双列滑轮两次点击确认（不再一点即确认）、
// 非法输入回退、受控回写。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { TimeInput, formatTimeBuffer, parseTimeText } from '../../src/client/components/time-input/TimeInput.js'

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
})

function field(): HTMLInputElement {
  return container!.querySelector<HTMLInputElement>('.wf-time__field')!
}

async function typeText(text: string): Promise<void> {
  await act(async () => {
    const input = field()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function blur(): Promise<void> {
  await act(async () => {
    // React onBlur 由 focusout 驱动（jsdom 下仅派发 blur 可能不触发）
    field().dispatchEvent(new Event('focusout', { bubbles: true }))
    field().dispatchEvent(new Event('blur', { bubbles: true }))
  })
}

async function clickAndOpen(onChange: (v: string) => void): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(TimeInput, { value: '09:00', onChange }))
  })
  await act(async () => {
    container!.querySelector<HTMLButtonElement>('.wf-time__clock')!.click()
  })
}

describe('TimeInput 纯函数', () => {
  it('parseTimeText：支持 HH:mm / H:mm / HHmm / Hmm / HH / H', () => {
    expect(parseTimeText('11:25')).toEqual({ hour: 11, minute: 25 })
    expect(parseTimeText('9:30')).toEqual({ hour: 9, minute: 30 })
    expect(parseTimeText('1125')).toEqual({ hour: 11, minute: 25 })
    expect(parseTimeText('925')).toEqual({ hour: 9, minute: 25 })
    expect(parseTimeText('11')).toEqual({ hour: 11, minute: 0 })
    expect(parseTimeText('9')).toEqual({ hour: 9, minute: 0 })
    expect(parseTimeText('')).toBe(null)
    expect(parseTimeText('25:99')).toBe(null)
  })

  it('formatTimeBuffer：按位渐进格式（1125 → 11:25；925 → 9:25；9 → 9）', () => {
    expect(formatTimeBuffer('1125')).toBe('11:25')
    expect(formatTimeBuffer('925')).toBe('9:25')
    expect(formatTimeBuffer('9')).toBe('9')
    expect(formatTimeBuffer('112')).toBe('11:2')
    expect(formatTimeBuffer('')).toBe('')
  })
})

describe('TimeInput 组件', () => {
  it('文本输入：键入 1125 失焦后提交为 11:25', async () => {
    const log: string[] = []
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(TimeInput, { value: '09:00', onChange: (v) => log.push(v) }))
    })
    await typeText('1125')
    await blur()
    expect(log.at(-1)).toBe('11:25')
  })

  it('非法输入：回退原值，不提交', async () => {
    const log: string[] = []
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(TimeInput, { value: '09:00', onChange: (v) => log.push(v) }))
    })
    await typeText('25:99')
    await blur()
    expect(log).toHaveLength(0)
    expect(field().value).toBe('09:00')
  })

  it('滑轮：点「时」列不立即确认；再点「分」列才提交（两次点击）', async () => {
    const log: string[] = []
    await clickAndOpen((v) => log.push(v))
    // 点击小时 14
    await act(async () => {
      const hourOpts = Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-time__col')[0].querySelectorAll<HTMLButtonElement>('.wf-time__opt'))
      hourOpts[14]?.click()
    })
    expect(log).toHaveLength(0) // 只点一次未确认
    // 点击分钟 30
    await act(async () => {
      const minOpts = Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-time__col')[1].querySelectorAll<HTMLButtonElement>('.wf-time__opt'))
      minOpts[30]?.click()
    })
    expect(log.at(-1)).toBe('14:30')
  })
})
