// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useEditorActions.test.tsx
//
// useEditorActions（hooks/useEditorActions.ts）单测：
//   ① P4 父模板保存路径：saveEditor 对 source='template' 只调模板库接口保存，不派发实例变更；
//   ② 删除落库后的画布归属校验（缺陷修复：删除在途切文档会误清新文档的画布）——
//      在途期间已切到别的文档 → 只移除列表项、绝不清新文档画布；未切走 → 清空一次。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——useEditorActions 用例归入本文件。
// （运行锁定路径下 useEditorActions 的旁路拦截用例见 hooks/canvas-lock-and-autosave.test.tsx）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useEditorActions, type EditorActionsFace } from '../../../src/client/hooks/useEditorActions.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import { zh } from '../../../src/client/i18n.js'
import type { CanvasNode, StudioState } from '../../../src/client/studio/studio-types.js'
import type { StudioAction } from '../../../src/client/studio/studio-actions.js'

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

/** 可手动结算的 Promise（模拟删除落库在途）。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 全解锁的锁定集（删除与运行锁定无关）。 */
const unlocked = { enabled: false, nodes: [], edges: [], statusByNode: {}, lockedNodeIds: new Set<string>(), lockedEdgeIds: new Set<string>(), isNodeLocked: () => false, isEdgeLocked: () => false } as never

/**
 * 渲染 useEditorActions 并暴露 face；rerender 换入新状态（模拟删除在途期间用户切换文档）。
 * 钩子内部用 ref 跟踪最新 state，因此「回调读到的」以最后一次渲染为准。
 */
async function renderFace(state: StudioState, deps: {
  workflows?: unknown
  flowTemplates?: unknown
  templates?: unknown
  selection?: unknown
  remote?: unknown
} = {}): Promise<{
  face: EditorActionsFace
  dispatched: StudioAction[]
  rerender: (next: StudioState) => Promise<void>
}> {
  const dispatched: StudioAction[] = []
  let face: EditorActionsFace | null = null
  function Probe({ current }: { current: StudioState }): null {
    face = useEditorActions(
      current,
      ((action: StudioAction) => { dispatched.push(action) }) as never,
      (() => {}) as never,
      (() => {}) as never,
      zh,
      (deps.workflows ?? {}) as never,
      (deps.flowTemplates ?? {}) as never,
      (deps.templates ?? {}) as never,
      (deps.selection ?? {}) as never,
      (deps.remote ?? {}) as never,
      (async () => null) as never,
      (() => {}) as never,
      (() => {}) as never,
      (() => {}) as never,
      (() => {}) as never,
      unlocked,
    )
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe, { current: state }))
  })
  return {
    face: face!,
    dispatched,
    rerender: async (next: StudioState) => {
      await act(async () => {
        root!.render(React.createElement(Probe, { current: next }))
      })
    },
  }
}

/** 取出最近一次 CONFIRM_SET 的 onConfirm（删除实例需二次确认）。 */
function lastConfirm(dispatched: StudioAction[]): { onConfirm?: () => void } | undefined {
  return dispatched
    .map((action) => action as { type: string; confirm?: { onConfirm?: () => void } })
    .filter((action) => action.type === 'CONFIRM_SET' && action.confirm)
    .at(-1)?.confirm
}

describe('P4 父模板保存路径（useEditorActions）', () => {
  it('saveEditor 对 source=template 只写模板库，不派发实例变更', async () => {
    const base = createInitialState('s-1')
    const state: StudioState = {
      ...base,
      editor: { source: 'template', kind: 'role', id: 'tpl-parent' },
      templates: {
        ...base.templates,
        role: [{ id: 'tpl-parent', kind: 'agent', name: 'CEO', systemPrompt: '', provider: '', model: '', presetId: 'standard', retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '' } as never],
      },
    }
    const saved: Array<{ kind: string; id: string }> = []
    const { face, dispatched } = await renderFace(state, {
      templates: { saveTemplate: async (kind: string, template: { id: string }) => { saved.push({ kind, id: template.id }) } },
    })

    await act(async () => { await face.saveEditor() })
    expect(saved).toEqual([{ kind: 'role', id: 'tpl-parent' }])
    expect(dispatched.map((action) => action.type)).toEqual([])
  })
})

describe('删除在途切文档：画布归属校验（不清新文档画布）', () => {
  const flowA = { id: 'wf-a', sessionId: 's-1', mode: 'mode1', name: '工作流A', description: '', revision: 1, nodes: [], lines: [] }
  const flowB = { id: 'wf-b', sessionId: 's-1', mode: 'mode1', name: '工作流B', description: '', revision: 1, nodes: [], lines: [] }

  /** 当前打开工作流 A、画布上有 A 的节点的状态。 */
  function stateOnA(): StudioState {
    const nodeA: CanvasNode = { id: 'n-a', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A 的节点' } }
    return {
      ...createInitialState('s-1'),
      currentKind: 'workflow',
      currentId: 'wf-a',
      editor: { source: 'workflow', id: 'wf-a' },
      workflows: [flowA as never, flowB as never],
      canvas: { nodes: [nodeA], edges: [] },
    }
  }

  it('在途期间切到工作流 B → 无 CLEAR_CANVAS，列表项仍按删除结果移除', async () => {
    const pending = deferred<void>()
    // 真实的 workflows.deleteWorkflow 在远端删除成功后派发 WORKFLOW_REMOVED；这里以
    // 「委托给测试收集器」的方式沿用该契约（只关注画布归属校验这一被测行为）。
    const sink: { dispatch?: (action: StudioAction) => void } = {}
    const deleteWorkflow = vi.fn(async () => {
      await pending.promise
      sink.dispatch?.({ type: 'WORKFLOW_REMOVED', id: 'wf-a' } as StudioAction)
    })
    const { face, dispatched, rerender } = await renderFace(stateOnA(), { workflows: { deleteWorkflow } })
    sink.dispatch = (action) => { dispatched.push(action) }

    await act(async () => { await face.deleteEditor() })
    const confirm = lastConfirm(dispatched)
    expect(confirm).toBeDefined()

    // 用户确认删除 → 后端删除在途；期间切到工作流 B（画布换成 B 的内容）
    act(() => { confirm!.onConfirm?.() })
    const stateB: StudioState = { ...stateOnA(), currentId: 'wf-b', editor: { source: 'workflow', id: 'wf-b' }, canvas: { nodes: [], edges: [] } }
    await rerender(stateB)

    await act(async () => {
      pending.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(deleteWorkflow).toHaveBeenCalledWith(flowA)
    // 归属校验：被删的 A 已不是当前文档 → 绝不清 B 的画布（新文档内容不被误清）
    expect(dispatched.some((action) => action.type === 'CLEAR_CANVAS')).toBe(false)
    // 列表项仍按删除结果移除（删除本身照常生效）
    expect(dispatched.some((action) => action.type === 'WORKFLOW_REMOVED')).toBe(true)
  })

  it('未切走（删除期间仍停留在工作流 A）→ 清空画布一次（用户预期）', async () => {
    const deleteWorkflow = vi.fn(async () => {})
    const { face, dispatched } = await renderFace(stateOnA(), { workflows: { deleteWorkflow } })

    await act(async () => { await face.deleteEditor() })
    const confirm = lastConfirm(dispatched)
    await act(async () => {
      confirm!.onConfirm?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(deleteWorkflow).toHaveBeenCalledWith(flowA)
    expect(dispatched.filter((action) => action.type === 'CLEAR_CANVAS')).toHaveLength(1)
  })

  it('未入库草稿：直接移除并清空画布（不经确认框）', async () => {
    const draft = { ...flowA, _draft: true }
    const state: StudioState = { ...stateOnA(), workflows: [draft as never] }
    const { face, dispatched } = await renderFace(state, { workflows: { deleteWorkflow: vi.fn() } })

    await act(async () => { await face.deleteEditor() })

    expect(dispatched.map((action) => action.type)).toEqual(['WORKFLOW_REMOVED', 'CLEAR_CANVAS', 'CLEAR_SELECTION'])
  })

  it('工作流模板在途切文档 → 无 CLEAR_CANVAS；未切走 → 清空一次', async () => {
    const template = { id: 't-1', mode: 'mode1', name: '模板', description: '', nodes: [], lines: [] }
    const base: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 't-1',
      editor: { source: 'flowTemplate', id: 't-1' },
      flowTemplates: [template as never],
      canvas: { nodes: [], edges: [] },
    }

    // ① 在途切换到别的文档
    const firstPending = deferred<void>()
    const deleteFirst = vi.fn(() => firstPending.promise)
    const first = await renderFace(base, { flowTemplates: { deleteFlowTemplate: deleteFirst } })
    await act(async () => { await first.face.deleteEditor() })
    const switched: StudioState = { ...base, currentKind: 'flowTemplate', currentId: 't-2', editor: { source: 'flowTemplate', id: 't-2' } }
    await first.rerender(switched)
    await act(async () => {
      firstPending.resolve()
      await Promise.resolve()
    })
    expect(first.dispatched.some((action) => action.type === 'CLEAR_CANVAS')).toBe(false)

    // ② 未切走（仍是当前模板）
    const second = await renderFace(base, { flowTemplates: { deleteFlowTemplate: vi.fn(async () => {}) } })
    await act(async () => {
      await second.face.deleteEditor()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(second.dispatched.filter((action) => action.type === 'CLEAR_CANVAS')).toHaveLength(1)
  })

  it('服务在途切文档 → 无 CLEAR_CANVAS', async () => {
    const service = { id: 'svc-1', sessionId: 's-1', name: '服务', mode: 'mode1', revision: 1, nodes: [], lines: [] }
    const serviceState: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'service',
      currentId: 'svc-1',
      editor: { source: 'service', id: 'svc-1' },
      services: [service as never],
      canvas: { nodes: [], edges: [] },
    }
    const pending = deferred<void>()
    const call = vi.fn(() => pending.promise)
    const { face, dispatched, rerender } = await renderFace(serviceState, { remote: { call } })

    await act(async () => { await face.deleteEditor() })
    const confirm = lastConfirm(dispatched)
    act(() => { confirm!.onConfirm?.() })
    await rerender({ ...serviceState, currentKind: 'workflow', currentId: 'wf-b', editor: { source: 'workflow', id: 'wf-b' } })
    await act(async () => {
      pending.resolve()
      await Promise.resolve()
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(dispatched.some((action) => action.type === 'CLEAR_CANVAS')).toBe(false)
    expect(dispatched.some((action) => action.type === 'SERVICE_REMOVED')).toBe(true)
  })
})
