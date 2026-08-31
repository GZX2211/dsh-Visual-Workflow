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
  it('渲染双月（左：锚定月，右：下月）+ 星期表头', async () => {
    await render({ start: null, end: null }, () => {})
    const titles = qall<HTMLElement>('.wf-cal-month__title').map((item) => item.textContent)
    expect(titles).toHaveLength(2)
    expect(titles[1]).toMatch(/年\d+月/)
    expect(qall('.wf-cal-week').length).toBeGreaterThanOrEqual(7)
    expect(container!.textContent).toContain('日')
    expect(container!.textContent).toContain('六')
  })

  it('点选语义：起点 → 终点（范围）→ 再点重置起点', async () => {
    const selected: DateRangeValue[] = []
    await renderStateful({ start: '2026-08-01', end: null }, selected)
    // 锚定 2026-08；右面板 2026-09；点右面板 10 号 → 终点
    await act(async () => {
      const rightPanel = qall<HTMLElement>('.wf-cal-month')[1]
      const button = Array.from(rightPanel.querySelectorAll<HTMLButtonElement>('.wf-cal-cell'))
        .find((item) => item.textContent === '10')
      button?.click()
    })
    expect(selected.at(-1)).toEqual({ start: '2026-08-01', end: '2026-09-10' })
    // 再点 20 号 → 重置起点
    await act(async () => {
      const rightPanel = qall<HTMLElement>('.wf-cal-month')[1]
      const button = Array.from(rightPanel.querySelectorAll<HTMLButtonElement>('.wf-cal-cell'))
        .find((item) => item.textContent === '20')
      button?.click()
    })
    expect(selected.at(-1)).toEqual({ start: '2026-09-20', end: null })
  })

  it('点选早于起点的日期：重置起点', async () => {
    const selected: DateRangeValue[] = []
    await render({ start: '2026-09-10', end: null }, (value) => selected.push(value))
    // 翻回 8 月（左面板 ‹）
    await act(async () => {
      const nav = container!.querySelector<HTMLButtonElement>('.wf-cal-nav')
      nav?.click()
    })
    await act(async () => {
      const button = qall<HTMLButtonElement>('.wf-cal-cell').find((item) => item.textContent === '1' && !item.disabled)
      button?.click()
    })
    expect(selected.at(-1)?.start).toBe('2026-08-01')
    expect(selected.at(-1)?.end).toBe(null)
  })

  it('范围两端样式类生效（起点/终点/范围内）', async () => {
    await render({ start: '2026-08-01', end: '2026-08-31' }, () => {})
    expect(qall('.wf-cal-cell.is-start').length).toBe(1)
    expect(qall('.wf-cal-cell.is-end').length).toBe(1)
    expect(qall('.wf-cal-cell.is-in-range').length).toBeGreaterThan(0)
  })

  it('挂载即卸载无泄漏（root.unmount 后 DOM 清空）', async () => {
    await render({ start: null, end: null }, () => {})
    await act(async () => {
      root?.unmount()
    })
    expect(container!.childElementCount).toBe(0)
  })
})
