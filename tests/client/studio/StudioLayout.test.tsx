// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/StudioLayout.test.tsx
//
// 「渲染层收到的派生 props」身份与 instanceOptions 落盘时序用例：
//   - D06-08：装配层（Studio）必须把逐实例派生数据与代理补丁角标按 state 记忆化——**同一 state
//     下重渲染**时 props 引用恒等。此前 agentPatchedNodeIds 在 JSX 内直接调选择器、实例列表在
//     渲染函数里现算，每次渲染都产生新引用（下游 props 比较/记忆化全部失效）。
//     观测点：把 StudioLayout 换成「记录 props + 委托真实实现」的包装组件，断言的是真实传入的
//     props 对象，不是「源码里出现了 useMemo」。
//   - D06-09：工作区路径逐字符输入只在防抖窗口结束后落盘一次（此前每次 dispatch 同步写盘）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Studio } from '../../../src/client/studio/Studio.js'
import type { StudioLayoutProps } from '../../../src/client/studio/StudioLayout.js'
import { INSTANCE_OPTIONS_KEY } from '../../../src/client/studio/instance-options.js'
import { useInstanceOptionsCache } from '../../../src/client/studio/useInstanceOptionsCache.js'
import { zh } from '../../../src/client/i18n.js'
import type { StorageLike } from '../../../src/client/lib/storage.js'
import { flushAsync } from '../fixtures/async-flush.js'
import { mountStudio, remoteStub } from '../fixtures/studio-harness.js'

/** 渲染层收到的 props 记录（每次渲染 push 一份）。 */
const layoutRenders = vi.hoisted(() => [] as unknown[])

vi.mock('../../../src/client/studio/StudioLayout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/client/studio/StudioLayout.js')>()
  return {
    ...actual,
    // 只做记录 + 委托：真实渲染层的 hooks 与子树行为不变
    StudioLayout: (props: unknown) => {
      layoutRenders.push(props)
      return React.createElement(actual.StudioLayout as never, props as never)
    },
  }
})

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  localStorage.clear()
  layoutRenders.length = 0
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

/** 已记录的渲染层 props（按渲染先后）。 */
function renders(): StudioLayoutProps[] {
  return layoutRenders as StudioLayoutProps[]
}

/** 工作区路径受控输入（受控 input 必须走原生 value setter 才能触发 React onChange）。 */
async function typeWorkspace(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('渲染层派生 props 身份稳定（D06-08）', () => {
  it('同一 state 下重渲染：补丁角标与左栏库 props 引用恒等（不得每次渲染重建）', async () => {
    const remote = remoteStub({
      workflows: [{ id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '流程一', description: '', nodes: [], lines: [] }],
    })
    await mountStudio(container!, (next) => { root = next }, remote, { flushBoot: true })
    await flushAsync(4) // 冲刷挂载期的即时应答（轮询首轮），保证下面两次渲染同属一个 state

    const first = renders().at(-1)!
    // 派生确实非空（否则「引用恒等」对空数组毫无鉴别力）
    expect(first.libraryProps.workflows.map((item) => item.id)).toEqual(['wf-1'])
    expect(first.agentPatchedNodeIds).toEqual([])

    await act(async () => {
      root!.render(React.createElement(Studio, { t: zh, sessionId: 's-1', remote }))
    })
    const second = renders().at(-1)!
    // 前提：确实发生了新的一次渲染，且 state 未变（同一 state 下的重渲染）
    expect(second).not.toBe(first)
    expect(second.state).toBe(first.state)
    // 断言：派生 props 引用恒等
    expect(second.agentPatchedNodeIds).toBe(first.agentPatchedNodeIds)
    expect(second.libraryProps).toBe(first.libraryProps)
    expect(second.libraryProps.workflows).toBe(first.libraryProps.workflows)
  })
})

// ---------------------------------------------------------------------------
// D06-09：工作区路径逐字符输入 → 防抖后只落盘一次
// ---------------------------------------------------------------------------

describe('instanceOptions 落盘（D06-09）', () => {
  it('连续输入只写一次存储，且防抖窗口内不写', async () => {
    vi.useFakeTimers()
    try {
      const remote = remoteStub()
      await mountStudio(container!, (next) => { root = next }, remote)
      // 进入模板态（「开启新会话」复选框与工作区输入框仅模板态显示）
      await act(async () => {
        document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
      })
      // 勾选「开启新会话」→ 工作区输入框出现
      await act(async () => {
        document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')?.click()
      })
      const workspace = document.querySelector<HTMLInputElement>('.wf-toolbar__workspace')
      expect(workspace).toBeTruthy()

      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      // 连续 5 次输入（每次都在上一窗口内）：不落盘
      for (const value of ['C', 'C:', 'C:/', 'C:/w', 'C:/work']) await typeWorkspace(workspace!, value)
      expect(setItem.mock.calls.filter((call) => call[0] === INSTANCE_OPTIONS_KEY)).toHaveLength(0)
      // 静默窗口不足：仍不落盘
      await act(async () => { await vi.advanceTimersByTimeAsync(299) })
      expect(setItem.mock.calls.filter((call) => call[0] === INSTANCE_OPTIONS_KEY)).toHaveLength(0)

      // 窗口结束：只写一次，且写入的是最后一次输入的值
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      const writes = setItem.mock.calls.filter((call) => call[0] === INSTANCE_OPTIONS_KEY)
      expect(writes).toHaveLength(1)
      // 「开启新会话」已勾选（工作区输入框仅在 newSession=true 时渲染），故落盘值为 true
      expect(JSON.parse(String(writes[0]![1]))).toEqual({ newSession: true, workspacePath: 'C:/work' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('落盘值未变时不写存储（初始值来自缓存恢复 → 同值重渲染不产生写入）', async () => {
    vi.useFakeTimers()
    try {
      const store: Record<string, string> = {}
      const storage: StorageLike = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
      }
      const setItem = vi.spyOn(storage, 'setItem')
      function Harness({ options }: { options: { newSession: boolean; workspacePath: string } }) {
        useInstanceOptionsCache(options, storage)
        return null
      }
      const options = { newSession: true, workspacePath: 'C:/work' }
      await act(async () => {
        root = createRoot(container!)
        root.render(React.createElement(Harness, { options }))
      })
      // 同值重复驱动（新对象、内容相同）不得落盘
      await act(async () => { root!.render(React.createElement(Harness, { options: { ...options } })) })
      expect(setItem).not.toHaveBeenCalled()

      // 值真正变化 → 防抖窗口结束后落盘一次
      await act(async () => { root!.render(React.createElement(Harness, { options: { newSession: true, workspacePath: 'C:/other' } })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(store[INSTANCE_OPTIONS_KEY]).toBe(JSON.stringify({ newSession: true, workspacePath: 'C:/other' }))
    } finally {
      vi.useRealTimers()
    }
  })
})
