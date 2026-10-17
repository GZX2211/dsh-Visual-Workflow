// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/StudioLayout.test.tsx
//
// 「渲染层收到的派生 props」身份与界面记忆落盘时序用例：
//   - D06-08：装配层（Studio）必须把逐实例派生数据与代理补丁角标按 state 记忆化——**同一 state
//     下重渲染**时 props 引用恒等。此前 agentPatchedNodeIds 在 JSX 内直接调选择器、实例列表在
//     渲染函数里现算，每次渲染都产生新引用（下游 props 比较/记忆化全部失效）。
//     观测点：把 StudioLayout 换成「记录 props + 委托真实实现」的包装组件，断言的是真实传入的
//     props 对象，不是「源码里出现了 useMemo」。
//   - 新会话选项落盘口径（模板级持久化后）：模板态勾选/路径变更**立即保存模板**，
//     不再写 localStorage 界面记忆；localStorage 只保留资产态一次性勾选的防抖记忆。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Studio } from '../../../src/client/studio/Studio.js'
import type { StudioLayoutProps } from '../../../src/client/studio/StudioLayout.js'
import { INSTANCE_OPTIONS_KEY, type InstanceOptions } from '../../../src/client/studio/instance-options.js'
import { useInstanceOptionsCache } from '../../../src/client/studio/useInstanceOptionsCache.js'
import { zh } from '../../../src/client/i18n.js'
import type { StorageLike } from '../../../src/client/lib/storage.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { WorkflowTemplate } from '../../../src/host/shared/graph-model.js'
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
// 新会话选项落盘：模板态立即保存模板；资产态一次性勾选防抖记忆
// ---------------------------------------------------------------------------

describe('新会话选项落盘口径', () => {
  it('模板态勾选 → 立即保存模板（携带 startNewSession），不写 localStorage 界面记忆', async () => {
    const remote = remoteStub()
    await mountStudio(container!, (next) => { root = next }, remote, { flushBoot: true })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    // 新建工作流模板草稿 → 模板态（「开启新会话」复选框仅实例来源态显示）
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
    })
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
    await act(async () => { checkbox!.click() })
    await flushAsync(2)

    const put = remote.calls.find((call) => call.endpoint === EP.EP_PUT_FLOW_TEMPLATE)
    expect(put).toBeTruthy()
    expect((put?.args.template as WorkflowTemplate).startNewSession).toBe(true)
    // 模板级持久化后不再依赖全局界面记忆
    expect(setItem.mock.calls.filter((call) => call[0] === INSTANCE_OPTIONS_KEY)).toHaveLength(0)
  })

  it('资产态选项：防抖窗口结束后落盘一次，同值不写', async () => {
    vi.useFakeTimers()
    try {
      const store: Record<string, string> = {}
      const storage: StorageLike = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
      }
      const setItem = vi.spyOn(storage, 'setItem')
      function Harness({ options }: { options: InstanceOptions | null }) {
        useInstanceOptionsCache(options, storage)
        return null
      }
      const options: InstanceOptions = { newSession: true }
      await act(async () => {
        root = createRoot(container!)
        root.render(React.createElement(Harness, { options }))
      })
      // 同值重复驱动（新对象、内容相同）不得落盘
      await act(async () => { root!.render(React.createElement(Harness, { options: { ...options } })) })
      expect(setItem).not.toHaveBeenCalled()

      // 值真正变化 → 防抖窗口结束后落盘一次
      await act(async () => { root!.render(React.createElement(Harness, { options: { newSession: false } })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(store[INSTANCE_OPTIONS_KEY]).toBe(JSON.stringify({ newSession: false }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('options 为 null（模板态/实例态）→ 不写任何界面记忆', async () => {
    vi.useFakeTimers()
    try {
      const setItem = vi.fn()
      const storage: StorageLike = { getItem: () => null, setItem }
      function Harness(): null {
        useInstanceOptionsCache(null, storage)
        return null
      }
      await act(async () => {
        root = createRoot(container!)
        root.render(React.createElement(Harness))
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
