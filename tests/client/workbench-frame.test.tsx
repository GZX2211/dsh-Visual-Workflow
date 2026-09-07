// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/workbench-frame.test.tsx
//
// 工作台统一窗口框架（WorkbenchFrame）——「切换窗口」零副作用回归测试：
//   - BUG 背景：旧实现（WorkbenchHost 双分支）在 float/split 各自渲染一份 <Studio>，
//     切换视图模式时 React 卸载并重建整个内容子树，画布内容/未保存修改/运行快照/
//     轮询结果/布局等全部状态丢失（用户实证）。
//   - 本测试用「挂载探针」断言：float → split → float 往返切换中，内容组件
//     **不被卸载重建**（mount 次数恒为 1）——视图切换退化为纯外壳样式切换。
//   - 结构断言：float 形态渲染八向缩放把手、无分隔线；split 形态渲染分隔线、
//     无缩放把手；根元素 data-wf-frame 标记与类名随模式切换。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WorkbenchFrame } from '../../src/client/studio/WorkbenchFrame.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  localStorage.clear()
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
})

/** 挂载探针：mount 次数累计到外部计数（卸载重挂载会再次触发 effect）。 */
function makeProbe(counter: { mounts: number }) {
  return function Probe() {
    useEffect(() => {
      counter.mounts += 1
    }, [])
    return <div data-probe="" />
  }
}

describe('WorkbenchFrame：视图模式切换不卸载内容（BUG「切换窗口丢状态」回归）', () => {
  it('float → split → float 往返切换：内容组件恒挂载（mount 次数保持 1）', async () => {
    const counter = { mounts: 0 }
    const Probe = makeProbe(counter)
    const onClose = vi.fn()
    const onResize = vi.fn()

    const renderFrame = (mode: 'float' | 'split') =>
      act(async () => {
        root!.render(
          <WorkbenchFrame mode={mode} onClose={onClose} splitWidth={640} onResize={onResize}>
            {() => <Probe />}
          </WorkbenchFrame>,
        )
      })

    root = createRoot(container!)
    await renderFrame('float')
    expect(counter.mounts).toBe(1)
    expect(container!.querySelector('[data-wf-frame="float"]')).toBeTruthy()

    // 切到分栏：内容不得卸载重建（mount 次数不变）
    await renderFrame('split')
    expect(counter.mounts).toBe(1)
    expect(container!.querySelector('[data-wf-frame="split"]')).toBeTruthy()

    // 切回浮窗：依旧不重建
    await renderFrame('float')
    expect(counter.mounts).toBe(1)
    expect(container!.querySelector('[data-wf-frame="float"]')).toBeTruthy()
  })

  it('浮窗形态：八向缩放把手存在、无分隔线；分栏形态：分隔线存在、无缩放把手', async () => {
    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="float" onClose={() => {}} splitWidth={640} onResize={() => {}}>
          {() => <div data-content="" />}
        </WorkbenchFrame>,
      )
    })
    // 浮窗：8 个缩放把手 + 无分隔线
    expect(container!.querySelectorAll('.wf-window__resize').length).toBe(8)
    expect(container!.querySelector('.wf-split-divider')).toBeNull()

    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="split" onClose={() => {}} splitWidth={640} onResize={() => {}}>
          {() => <div data-content="" />}
        </WorkbenchFrame>,
      )
    })
    // 分栏：分隔线（absolute 左缘）+ 无缩放把手
    expect(container!.querySelector('.wf-split-divider')).toBeTruthy()
    expect(container!.querySelectorAll('.wf-window__resize').length).toBe(0)
  })

  it('内容容器恒为根元素第 0 个子节点（React 位置稳定是实例保持的前提）', async () => {
    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="float" onClose={() => {}} splitWidth={640} onResize={() => {}}>
          {() => <div data-content="" />}
        </WorkbenchFrame>,
      )
    })
    const shell = container!.querySelector('[data-wf-frame]')!
    const firstChild = shell.firstElementChild
    expect(firstChild?.classList.contains('wf-frame-content')).toBe(true)
    expect(firstChild?.querySelector('[data-content]')).toBeTruthy()

    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="split" onClose={() => {}} splitWidth={640} onResize={() => {}}>
          {() => <div data-content="" />}
        </WorkbenchFrame>,
      )
    })
    const shell2 = container!.querySelector('[data-wf-frame]')!
    expect(shell2.firstElementChild?.classList.contains('wf-frame-content')).toBe(true)
    expect(shell2.firstElementChild?.querySelector('[data-content]')).toBeTruthy()
  })

  it('api 传递：children 收到 close（标题栏 × 关闭工作台）；close 回调可触发', async () => {
    const onClose = vi.fn()
    let receivedClose: (() => void) | null = null
    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="float" onClose={onClose} splitWidth={640} onResize={() => {}}>
          {(api) => {
            receivedClose = api.close
            return <button data-close="" onClick={api.close} />
          }}
        </WorkbenchFrame>,
      )
    })
    expect(receivedClose).toBeTypeOf('function')
    await act(async () => {
      ;(container!.querySelector('[data-close]') as HTMLButtonElement).click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('WorkbenchFrame：关闭（hidden）不卸载内容（BUG「入口重进丢状态」回归）', () => {
  it('hidden 往返：外壳 display:none↔恢复，内容组件恒挂载（mount 次数保持 1）', async () => {
    const counter = { mounts: 0 }
    const Probe = makeProbe(counter)
    const renderWithHidden = (hidden: boolean) =>
      act(async () => {
        root!.render(
          <WorkbenchFrame mode="float" onClose={() => {}} splitWidth={640} onResize={() => {}} hidden={hidden}>
            {() => <Probe />}
          </WorkbenchFrame>,
        )
      })

    root = createRoot(container!)
    await renderWithHidden(false)
    expect(counter.mounts).toBe(1)
    const shell = container!.querySelector('[data-wf-frame]') as HTMLElement
    expect(shell).toBeTruthy()
    expect(shell.style.display).not.toBe('none')

    // 关闭：外壳 display:none（⚠️ 不能用 HTML hidden 属性——CSS display:flex 会覆盖）
    await renderWithHidden(true)
    expect(counter.mounts).toBe(1)
    expect(shell.style.display).toBe('none')
    expect(container!.querySelector('[data-probe]')).toBeTruthy()

    // 重开：恢复显示且内容从未卸载重建
    await renderWithHidden(false)
    expect(counter.mounts).toBe(1)
    expect(shell.style.display).not.toBe('none')
  })

  it('分栏形态同样支持 hidden（display:none）；内容保持挂载', async () => {
    const counter = { mounts: 0 }
    const Probe = makeProbe(counter)
    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="split" onClose={() => {}} splitWidth={640} onResize={() => {}} hidden>
          {() => <Probe />}
        </WorkbenchFrame>,
      )
    })
    const shell = container!.querySelector('[data-wf-frame="split"]') as HTMLElement
    expect(shell).toBeTruthy()
    expect(shell.style.display).toBe('none')
    // 显示恢复后同一实例继续挂载
    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="split" onClose={() => {}} splitWidth={640} onResize={() => {}}>
          {() => <Probe />}
        </WorkbenchFrame>,
      )
    })
    expect(counter.mounts).toBe(1)
    expect(shell.style.display).not.toBe('none')
    expect(container!.querySelector('.wf-split-divider')).toBeTruthy()
  })

  it('hidden 不传（undefined）时行为与旧版本一致（默认显示）', async () => {
    root = createRoot(container!)
    await act(async () => {
      root!.render(
        <WorkbenchFrame mode="float" onClose={() => {}} splitWidth={640} onResize={() => {}}>
          {() => <div data-content="" />}
        </WorkbenchFrame>,
      )
    })
    const shell = container!.querySelector('[data-wf-frame]') as HTMLElement
    expect(shell.style.display).not.toBe('none')
    expect(container!.querySelector('[data-content]')).toBeTruthy()
  })
})