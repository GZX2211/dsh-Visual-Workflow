// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/modal/Modal.test.tsx
//
// 弹层原语（D07-06）结构用例：role="dialog" + aria-modal + 可访问名 + 初始聚焦 +
// Escape 关闭 + 焦点约束（Tab 循环、嵌套/平级只作用于最上层）+ 关闭后焦点归还。
// 断言对象是读屏与键盘用户可观察到的结构与行为，不依赖具体弹层的业务内容。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Modal } from '../../../../src/client/components/modal/Modal.js'

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

function modalBody(): React.ReactNode {
  return (
    <>
      <button type="button" className="first-btn">一</button>
      <input className="mid-input" />
      <button type="button" className="last-btn">末</button>
    </>
  )
}

function modalOf(onClose: () => void, children: React.ReactNode = modalBody()): React.ReactElement {
  return (
    <Modal className="wf-test" backdropClassName="wf-test-backdrop" label="测试弹层" onClose={onClose}>
      {children}
    </Modal>
  )
}

function render(element: React.ReactElement): void {
  act(() => {
    root = createRoot(container!)
    root.render(element)
  })
}

function dialogEl(selector = '[role="dialog"]'): HTMLElement {
  return container!.querySelector<HTMLElement>(selector)!
}

function keydown(key: string, options: KeyboardEventInit = {}): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
  })
}

describe('弹层原语（Modal）', () => {
  it('结构：role="dialog" + aria-modal + 可访问名，调用方外观类与背景类名原样保留', () => {
    render(modalOf(vi.fn()))

    const dialog = dialogEl()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('测试弹层')
    expect(dialog.getAttribute('tabindex')).toBe('-1')
    expect(dialog.classList.contains('wf-modal')).toBe(true)
    expect(dialog.classList.contains('wf-test')).toBe(true)
    expect(container!.querySelector('.wf-test-backdrop')).not.toBeNull()
  })

  it('初始聚焦落在弹层容器（不误触弹层内的默认动作）', () => {
    render(modalOf(vi.fn()))
    expect(document.activeElement).toBe(dialogEl())
  })

  it('Escape 触发关闭请求；其它按键不触发', () => {
    const onClose = vi.fn()
    render(modalOf(onClose))

    keydown('a')
    keydown('Enter')
    expect(onClose).not.toHaveBeenCalled()

    keydown('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('焦点约束：Tab 在弹层内循环，焦点被移出后拉回弹层', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    render(modalOf(vi.fn()))

    const dialog = dialogEl()
    const first = dialog.querySelector<HTMLElement>('.first-btn')!
    const last = dialog.querySelector<HTMLElement>('.last-btn')!

    // 焦点停在弹层容器（初始状态）→ Tab 进入弹层内首个可聚焦元素
    keydown('Tab')
    expect(document.activeElement).toBe(first)

    // 末元素 Tab → 回到首个（不逃逸到背景元素）
    act(() => { last.focus() })
    keydown('Tab')
    expect(document.activeElement).toBe(first)

    // 首元素 Shift+Tab → 回到末个
    keydown('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)

    // 焦点被移到弹层外（如点击背景）→ Tab 拉回弹层内
    act(() => { outside.focus() })
    keydown('Tab')
    expect(document.activeElement).toBe(first)

    outside.remove()
  })

  it('弹层内无可聚焦元素：Tab 不把焦点放走，仍停在弹层容器', () => {
    render(modalOf(vi.fn(), <span className="only-text">只读</span>))
    expect(document.activeElement).toBe(dialogEl())

    keydown('Tab')
    expect(document.activeElement).toBe(dialogEl())
  })

  it('onClose 引用变化不重装监听、不抢已进入输入框的焦点，且 Escape 走最新回调', () => {
    render(modalOf(vi.fn()))
    const input = dialogEl().querySelector<HTMLInputElement>('.mid-input')!
    act(() => { input.focus() })
    expect(document.activeElement).toBe(input)

    // 调用方每次都传内联箭头函数（引用必变）：重渲染不得重置聚焦
    const latest = vi.fn()
    act(() => { root!.render(modalOf(latest)) })
    expect(document.activeElement).toBe(input)

    keydown('Escape')
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('关闭后把焦点归还给打开它的元素', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    act(() => { trigger.focus() })

    render(modalOf(vi.fn()))
    expect(document.activeElement).toBe(dialogEl())

    act(() => { root!.unmount() })
    root = null
    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })
})

describe('弹层原语（Modal）嵌套与层级', () => {
  /** 真嵌套：子弹层在 DOM 上位于父弹层内部（effect 执行顺序与视觉层级相反）。 */
  function nestedTree(outerClose: () => void, innerClose: () => void, innerOpen: boolean): React.ReactElement {
    return (
      <Modal className="wf-outer" backdropClassName="wf-outer-backdrop" label="外层" onClose={outerClose}>
        <button type="button" className="outer-btn">外层</button>
        {innerOpen
          ? (
              <Modal className="wf-inner" backdropClassName="wf-inner-backdrop" label="内层" onClose={innerClose}>
                <button type="button" className="inner-btn">内层</button>
              </Modal>
            )
          : null}
      </Modal>
    )
  }

  it('嵌套弹层：焦点与 Escape 只作用于最上层（内层），关掉内层后外层才响应', () => {
    const outerClose = vi.fn()
    const innerClose = vi.fn()
    render(nestedTree(outerClose, innerClose, true))

    // 子弹层是活动层（父弹层不抢焦点）
    expect(document.activeElement).toBe(dialogEl('.wf-inner'))

    keydown('Escape')
    expect(innerClose).toHaveBeenCalledTimes(1)
    expect(outerClose).not.toHaveBeenCalled()

    // 内层卸载（关闭）后，外层回到最上层
    act(() => { root!.render(nestedTree(outerClose, innerClose, false)) })
    keydown('Escape')
    expect(outerClose).toHaveBeenCalledTimes(1)
  })

  it('平级弹层：后打开的在上层，Escape 不关闭先打开的弹层', () => {
    const firstClose = vi.fn()
    const secondClose = vi.fn()
    render(
      <>
        <Modal className="wf-first" backdropClassName="wf-first-backdrop" label="先开" onClose={firstClose}>
          <button type="button">先开</button>
        </Modal>
        <Modal className="wf-second" backdropClassName="wf-second-backdrop" label="后开" onClose={secondClose}>
          <button type="button">后开</button>
        </Modal>
      </>,
    )

    expect(document.activeElement).toBe(dialogEl('.wf-second'))
    keydown('Escape')
    expect(secondClose).toHaveBeenCalledTimes(1)
    expect(firstClose).not.toHaveBeenCalled()
  })
})
