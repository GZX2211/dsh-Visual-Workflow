// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/date-picker.test.tsx
//
// 双月日历组件：双月渲染（左：锚定月，右：下月）、翻月、点选范围语义
// （起点 → 终点 → 重置）、早于起点的点击重置起点、范围样式类。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { DateRangePicker, type DateRangeValue } from '../../src/client/components/date-picker/DateRangePicker.js'

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

function qall<T extends Element>(selector: string): T[] {
  return Array.from(container!.querySelectorAll<T>(selector))
}

async function render(value: DateRangeValue, onChange: (v: DateRangeValue) => void): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(DateRangePicker, { value, onChange }))
  })
}

/** 有状态容器（受控组件真实用法：onChange 回写 value 触发重渲）。 */
function StatefulPicker({ initial, log }: { initial: DateRangeValue; log: DateRangeValue[] }) {
  const [value, setValue] = React.useState(initial)
  return React.createElement(DateRangePicker, {
    value,
    onChange: (next) => {
      log.push(next)
      setValue(next)
    },
  })
}

async function renderStateful(initial: DateRangeValue, log: DateRangeValue[]): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(StatefulPicker, { initial, log }))
  })
}

describe('DateRangePicker', () => {
  it('渲染双月（左：起点月，右：次月）+ 星期表头', async () => {
    await render({ start: null, end: null }, () => {})
    const titles = qall<HTMLElement>('.wf-cal-month__title').map((item) => item.textContent)
    expect(titles).toHaveLength(2)
    expect(titles[0]).toMatch(/年\d+月/)
    expect(qall('.wf-cal-week').length).toBeGreaterThanOrEqual(7)
    expect(container!.textContent).toContain('日')
    expect(container!.textContent).toContain('六')
    // 每个面板都有 ‹ 和 ›（左右各自可切换）
    expect(qall('.wf-cal-nav').length).toBe(4)
  })

  it('左右月独立切换，且右月恒大于左月', async () => {
    await render({ start: '2026-08-01', end: null }, () => {})
    // 左面板：‹ 翻到 2026-07；右面板保持 2026-09
    const leftHead = qall<HTMLElement>('.wf-cal-month')[0]
    await act(async () => {
      const prev = leftHead.querySelector<HTMLButtonElement>('.wf-cal-nav')
      prev?.click() // 左 ‹
    })
    expect(qall<HTMLElement>('.wf-cal-month__title')[0].textContent).toBe('2026年7月')
    expect(qall<HTMLElement>('.wf-cal-month__title')[1].textContent).toBe('2026年9月')
    // 右面板：‹ 再从 2026-09 翻到 2026-08；但 8 月 == 左月，应被钳制为 2026-10（左月+1）
    const rightHead = qall<HTMLElement>('.wf-cal-month')[1]
    await act(async () => {
      const prev = rightHead.querySelector<HTMLButtonElement>('.wf-cal-nav')
      const buttons = Array.from(rightHead.querySelectorAll<HTMLButtonElement>('.wf-cal-nav'))
      buttons[0]?.click() // 右面板 ‹
    })
    const rightTitle = qall<HTMLElement>('.wf-cal-month__title')[1].textContent
    // 由于右月不可 ≤ 左月（2026-07），钳制为 2026-08 或更高；此处验证恒 > 左月
    const leftMonth = parseInt(qall<HTMLElement>('.wf-cal-month__title')[0].textContent!.slice(0, 4), 10) * 12 + parseInt(qall<HTMLElement>('.wf-cal-month__title')[0].textContent!.match(/(\d+)月/)![1], 10)
    const rightMonth = parseInt(qall<HTMLElement>('.wf-cal-month__title')[1].textContent!.slice(0, 4), 10) * 12 + parseInt(qall<HTMLElement>('.wf-cal-month__title')[1].textContent!.match(/(\d+)月/)![1], 10)
    expect(rightMonth).toBeGreaterThan(leftMonth)
    expect(rightTitle).toMatch(/2026年\d+月/)
  })

  it('点选语义：起点 → 终点（范围）→ 再点重置起点', async () => {
    const selected: DateRangeValue[] = []
    await renderStateful({ start: '2026-08-01', end: null }, selected)
    // 锚定 2026-08；右面板 2026-09；点右面板 10 号 → 终点
    await act(async () => {
      const rightPanel = qall<HTMLElement>('.wf-cal-month')[1]
      const button = Array.from(rightPanel.querySelectorAll<HTMLButtonElement>('.wf-cal-cell'))
        .find((item) => item.textContent?.startsWith('10'))
      button?.click()
    })
    expect(selected.at(-1)).toEqual({ start: '2026-08-01', end: '2026-09-10' })
    // 再点 20 号 → 重置起点
    await act(async () => {
      const rightPanel = qall<HTMLElement>('.wf-cal-month')[1]
      const button = Array.from(rightPanel.querySelectorAll<HTMLButtonElement>('.wf-cal-cell'))
        .find((item) => item.textContent?.startsWith('20'))
      button?.click()
    })
    expect(selected.at(-1)).toEqual({ start: '2026-09-20', end: null })
  })

  it('点选早于起点的日期：重置起点', async () => {
    const selected: DateRangeValue[] = []
    await render({ start: '2026-09-10', end: null }, (value) => selected.push(value))
    // 左面板 ‹ 翻回 8 月
    await act(async () => {
      const leftHead = qall<HTMLElement>('.wf-cal-month')[0]
      leftHead.querySelector<HTMLButtonElement>('.wf-cal-nav')?.click()
    })
    await act(async () => {
      const button = qall<HTMLButtonElement>('.wf-cal-cell').find((item) => item.textContent?.startsWith('1'))
      button?.click()
    })
    expect(selected.at(-1)?.start).toBe('2026-08-01')
    expect(selected.at(-1)?.end).toBe(null)
  })

  it('选中日期圆形高亮 + 数字下方「开始/结束」标签，无连续片段', async () => {
    await render({ start: '2026-08-01', end: '2026-08-31' }, () => {})
    expect(qall('.wf-cal-cell.is-start').length).toBe(1)
    expect(qall('.wf-cal-cell.is-end').length).toBe(1)
    // 不再渲染连续的范围内片段
    expect(qall('.wf-cal-cell.is-in-range').length).toBe(0)
    // 数字下方标签
    expect(qall('.wf-cal-cell__tag').map((t) => t.textContent)).toEqual(expect.arrayContaining(['开始', '结束']))
    // 起点数字为 1（带「开始」），终点数字为 31（带「结束」）
    const startCell = qall<HTMLElement>('.wf-cal-cell.is-start')[0]
    expect(startCell.querySelector('.wf-cal-cell__num')?.textContent).toBe('1')
    expect(startCell.querySelector('.wf-cal-cell__tag')?.textContent).toBe('开始')
    const endCell = qall<HTMLElement>('.wf-cal-cell.is-end')[0]
    expect(endCell.querySelector('.wf-cal-cell__tag')?.textContent).toBe('结束')
  })

  it('挂载即卸载无泄漏（root.unmount 后 DOM 清空）', async () => {
    await render({ start: null, end: null }, () => {})
    await act(async () => {
      root?.unmount()
    })
    expect(container!.childElementCount).toBe(0)
  })
})
