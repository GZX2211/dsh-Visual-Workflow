// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useKeyShortcuts.test.tsx
//
// 全局键盘快捷键契约（hooks/useKeyShortcuts.ts）：
//   ① Escape 在「输入控件聚焦」抑制分支**之前**处理——弹层关闭与选中清除在输入框里也必须生效；
//   ② Ctrl/Cmd+Z 撤销、加 Shift 重做（大小写不敏感），且必须 preventDefault（否则浏览器会把
//      编辑操作退回到自身的历史里）；
//   ③ Delete 先删选中连线、其次删选中节点，无选中时什么都不做；
//   ④ INPUT/TEXTAREA/SELECT 聚焦时 Ctrl+Z 与 Delete 一律跳过，并且**不** preventDefault
//      （不吞掉输入框自身的编辑/删除默认行为）；
//   ⑤ 卸载时移除 window 监听（副作用责任者可追踪）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useKeyShortcuts } from '../../../src/client/hooks/useKeyShortcuts.js'
import type { SelectionFace } from '../../../src/client/hooks/useSelection.js'
import type { GraphHistoryFace } from '../../../src/client/hooks/useGraphHistory.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import type { StudioState } from '../../../src/client/studio/studio-types.js'

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

interface Recorders {
  dispatched: string[]
  cleared: number
  undo: number
  redo: number
  removedLines: string[]
  removedSelected: number
}

/** 渲染快捷键 hook：依赖面全部是记录器（hook 只做编排，不自持状态）。 */
async function renderShortcuts(state: StudioState): Promise<Recorders> {
  const rec: Recorders = { dispatched: [], cleared: 0, undo: 0, redo: 0, removedLines: [], removedSelected: 0 }
  const selection: SelectionFace = {
    selectNode: () => {},
    selectEdge: () => {},
    selectLib: () => {},
    selectEditor: () => {},
    clearSelection: () => { rec.cleared += 1 },
  }
  const history: GraphHistoryFace = {
    remember: () => {},
    undo: () => { rec.undo += 1 },
    redo: () => { rec.redo += 1 },
    canUndo: true,
    canRedo: true,
  }
  function Probe(): null {
    useKeyShortcuts(
      state,
      ((action: { type: string }) => { rec.dispatched.push(action.type) }) as never,
      selection,
      history,
      (id: string) => rec.removedLines.push(id),
      () => { rec.removedSelected += 1 },
    )
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe))
  })
  return rec
}

/** 派发 keydown：默认目标为 window（非输入控件），可指定实际聚焦元素。 */
function press(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: HTMLElement } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true,
    shiftKey: options.shiftKey === true,
  })
  ;(options.target ?? window).dispatchEvent(event)
  return event
}

/** 造一个聚焦目标并把事件派发到它（事件冒泡到 window，故 target 即该控件）。 */
function pressOn(tag: 'input' | 'textarea' | 'select', key: string, options: { ctrlKey?: boolean } = {}): KeyboardEvent {
  const element = document.createElement(tag)
  document.body.append(element)
  try {
    return press(key, { ...options, target: element })
  } finally {
    element.remove()
  }
}

function stateWith(overrides: Partial<StudioState>): StudioState {
  return { ...createInitialState('s-1'), ...overrides }
}

describe('useKeyShortcuts：Escape', () => {
  it('确认框打开时：Escape 关闭确认框，且不清空选中', async () => {
    const rec = await renderShortcuts(stateWith({ confirm: { kind: 'unsaved' } }))

    press('Escape')

    expect(rec.dispatched).toEqual(['CONFIRM_SET'])
    expect(rec.cleared).toBe(0)
  })

  it('无确认框时：Escape 清空选中', async () => {
    const rec = await renderShortcuts(stateWith({}))

    press('Escape')

    expect(rec.cleared).toBe(1)
    expect(rec.dispatched).toEqual([])
  })

  it('输入控件聚焦时 Escape 仍生效（抑制分支只挡 Ctrl+Z 与 Delete）', async () => {
    const rec = await renderShortcuts(stateWith({}))

    pressOn('input', 'Escape')

    expect(rec.cleared).toBe(1)
  })
})

describe('useKeyShortcuts：Ctrl/Cmd+Z 撤销与重做', () => {
  it('Ctrl+Z 撤销并 preventDefault；加 Shift 变为重做（不重复撤销）', async () => {
    const rec = await renderShortcuts(stateWith({}))

    const undoEvent = press('z', { ctrlKey: true })
    expect(undoEvent.defaultPrevented).toBe(true)
    expect(rec.undo).toBe(1)

    press('z', { ctrlKey: true, shiftKey: true })
    expect(rec.redo).toBe(1)
    expect(rec.undo).toBe(1)
  })

  it('Cmd+Z（macOS metaKey）等价于 Ctrl+Z；大写 Z 同样识别（key 大小写不敏感）', async () => {
    const rec = await renderShortcuts(stateWith({}))

    press('z', { metaKey: true })
    expect(rec.undo).toBe(1)

    press('Z', { ctrlKey: true })
    expect(rec.undo).toBe(2)
  })

  it('无修饰键的 z 不触发撤销，也不 preventDefault', async () => {
    const rec = await renderShortcuts(stateWith({}))

    const event = press('z')

    expect(event.defaultPrevented).toBe(false)
    expect(rec.undo).toBe(0)
    expect(rec.redo).toBe(0)
  })

  it('输入控件聚焦时跳过：不撤销/不重做，也不 preventDefault（不吞输入框默认行为）', async () => {
    const rec = await renderShortcuts(stateWith({}))

    for (const tag of ['input', 'textarea', 'select'] as const) {
      const event = pressOn(tag, 'z', { ctrlKey: true })
      expect(event.defaultPrevented, `${tag} 聚焦时不应 preventDefault`).toBe(false)
    }

    expect(rec.undo).toBe(0)
    expect(rec.redo).toBe(0)
  })
})

describe('useKeyShortcuts：Delete 删除选中', () => {
  it('同时选中节点与连线时优先删除连线（不删节点）', async () => {
    const rec = await renderShortcuts(stateWith({ selection: { nodeId: 'n1', edgeId: 'e1', lib: null } }))

    const event = press('Delete')

    expect(event.defaultPrevented).toBe(true)
    expect(rec.removedLines).toEqual(['e1'])
    expect(rec.removedSelected).toBe(0)
  })

  it('仅选中节点时删除节点（不调用删连线）', async () => {
    const rec = await renderShortcuts(stateWith({ selection: { nodeId: 'n1', edgeId: null, lib: null } }))

    const event = press('Delete')

    expect(event.defaultPrevented).toBe(true)
    expect(rec.removedSelected).toBe(1)
    expect(rec.removedLines).toEqual([])
  })

  it('无选中时什么都不删，也不 preventDefault', async () => {
    const rec = await renderShortcuts(stateWith({ selection: { nodeId: null, edgeId: null, lib: { kind: 'workflow', id: 'wf-1' } } }))

    const event = press('Delete')

    expect(event.defaultPrevented).toBe(false)
    expect(rec.removedSelected).toBe(0)
    expect(rec.removedLines).toEqual([])
  })

  it('输入控件聚焦时跳过 Delete（不在输入框里误删画布节点）', async () => {
    const rec = await renderShortcuts(stateWith({ selection: { nodeId: 'n1', edgeId: 'e1', lib: null } }))

    const event = pressOn('input', 'Delete')

    expect(event.defaultPrevented).toBe(false)
    expect(rec.removedSelected).toBe(0)
    expect(rec.removedLines).toEqual([])
  })

  it('Backspace 不是删除快捷键（只认 Delete）', async () => {
    const rec = await renderShortcuts(stateWith({ selection: { nodeId: 'n1', edgeId: 'e1', lib: null } }))

    press('Backspace')

    expect(rec.removedSelected).toBe(0)
    expect(rec.removedLines).toEqual([])
  })
})

describe('useKeyShortcuts：生命周期', () => {
  it('卸载后移除 window 监听：三个快捷键都不再触发', async () => {
    const rec = await renderShortcuts(stateWith({ selection: { nodeId: 'n1', edgeId: 'e1', lib: null } }))
    act(() => { root!.unmount() })
    root = null

    press('Escape')
    press('Delete')
    press('z', { ctrlKey: true })

    expect(rec.cleared).toBe(0)
    expect(rec.removedSelected).toBe(0)
    expect(rec.removedLines).toEqual([])
    expect(rec.undo).toBe(0)
  })
})
