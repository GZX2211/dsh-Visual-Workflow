// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/canvas-lock-and-autosave.test.tsx
//
// 新机制单测（用户裁决 2026-02）：
//   ① 运行中保存实例 → 二次确认（保存会改变父代理后续编排），确认后才落库；
//   ② 纯 XY 拖动 / 组卡片缩放 → 防抖自动保存（不弹确认、静默、草稿态跳过）；
//   ③ 运行中画布锁定 → 已完成节点/其连线不可删除、执行中节点左入口不可改；
//      清空画布不再二次确认（运行中由工具栏禁用）。
//
// 依赖缝：hook 级装配（fake state + dispatch 收集 + fake saveCanvas），
// 不依赖远端真实实现；锁定规则本体见 tests/client/run-locks.test.ts。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useCanvasActions, GEOMETRY_AUTOSAVE_DEBOUNCE_MS, type CanvasActionsFace } from '../../src/client/hooks/useCanvasActions.js'
import { useDocumentActions, type DocumentActionsFace } from '../../src/client/hooks/useDocumentActions.js'
import { useEditorActions, type EditorActionsFace } from '../../src/client/hooks/useEditorActions.js'
import { computeRunLocks } from '../../src/client/lib/run-locks.js'
import { createInitialState } from '../../src/client/studio/studio-initial.js'
import type { CanvasEdge, CanvasNode, StudioAction, StudioState } from '../../src/client/studio/studio-state.js'
import type { GraphHistoryFace } from '../../src/client/hooks/useGraphHistory.js'
import type { WorkflowsFace } from '../../src/client/hooks/useWorkflows.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'
import { zh } from '../../src/client/i18n.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'

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
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 画布节点夹具（位置无关；data 为空对象）。 */
function node(id: string, kind: CanvasNode['kind'] = 'agent'): CanvasNode {
  return { id, kind, position: { x: 0, y: 0 }, data: {} }
}

/** 画布连线夹具。 */
function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

/** 运行中实例的状态夹具：n-done 已完成、n-run 执行中、n-next 待执行。 */
function runningState(): { state: StudioState; nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = [node('n-done'), node('n-run'), node('n-next')]
  const edges = [
    edge('e-done-in', 'n-run', 'n-done'), // 已完成节点的入线（锁）
    edge('e-done-out', 'n-done', 'n-next'), // 已完成节点的出线（锁）
    edge('e-run-in', 'n-next', 'n-run'), // 执行中节点的左入口（锁）
  ]
  const state: StudioState = {
    ...createInitialState('s-1'),
    currentKind: 'workflow',
    currentId: 'wf-1',
    workflows: [{ id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '流程', description: '', revision: 1, nodes: [], lines: [] }],
    canvas: { nodes, edges },
    dirty: true,
    activeRuns: [{ flowId: 'wf-1', sessionId: 's-1', status: 'running', runId: 'run-1' }],
  }
  return { state, nodes, edges }
}

/** 渲染 hook 并返回其 face（hook 级装配；dispatch 为收集器）。 */
async function renderHookFace<T>(useFace: () => T): Promise<T> {
  let face: T | null = null
  function Harness({ onReady }: { onReady: (f: T) => void }): null {
    const f = useFace()
    useEffect(() => { onReady(f) }, [f, onReady])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness, { onReady: (f: T) => { face = f } }))
  })
  return face!
}

/** 渲染画布编辑面（锁定判定 + 自动保存注入）。 */
async function renderCanvas(overrides: {
  state: StudioState
  dispatch: (action: StudioAction) => void
  notify: (kind: 'info' | 'success' | 'error', text: string) => void
  saveCanvas: (options?: { auto?: boolean }) => Promise<unknown>
}): Promise<CanvasActionsFace> {
  const { state, dispatch, notify, saveCanvas } = overrides
  const locks = computeRunLocks({ enabled: true, nodes: state.canvas.nodes, edges: state.canvas.edges, statusByNode: { 'n-done': 'ok', 'n-run': 'running' } })
  const history = { remember: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false } as unknown as GraphHistoryFace
  return renderHookFace(() => useCanvasActions(
    state,
    dispatch as never,
    notify as never,
    history,
    zh,
    { locks, saveCanvas },
  ))
}

/** 渲染文档操作面（保存二次确认路径）。 */
async function renderDocument(overrides: {
  state: StudioState
  dispatch: (action: StudioAction) => void
  saveWorkflow: WorkflowsFace['saveWorkflow']
  notify?: (kind: 'info' | 'success' | 'error', text: string) => void
}): Promise<DocumentActionsFace> {
  const { state, dispatch, saveWorkflow } = overrides
  const notify = overrides.notify ?? vi.fn()
  const noop = vi.fn()
  const workflows = { saveWorkflow } as unknown as WorkflowsFace
  const flowTemplates = { saveFlowTemplate: vi.fn(async (doc: unknown) => doc) } as unknown as Parameters<typeof useDocumentActions>[6]
  const templates = {} as Parameters<typeof useDocumentActions>[7]
  const selection = {} as Parameters<typeof useDocumentActions>[8]
  const serviceControl = { saveService: vi.fn(async (doc: unknown) => doc) } as unknown as Parameters<typeof useDocumentActions>[9]
  const remote = { call: vi.fn(async () => []) } as unknown as RemoteFace
  return renderHookFace(() => useDocumentActions(
    state,
    dispatch as never,
    { confirm: null, guard: noop, saveAndProceed: noop, discardAndProceed: noop, cancel: noop },
    notify as never,
    noop as never,
    workflows,
    flowTemplates,
    templates,
    selection,
    serviceControl,
    remote,
    zh,
  ))
}

/** 渲染编辑器面（验证「运行前已选中的被锁连线」字段编辑旁路被拦截）。 */
async function renderEditorFace(overrides: {
  state: StudioState
  dispatch: (action: StudioAction) => void
  locks: ReturnType<typeof computeRunLocks>
  templates?: unknown
  flowTemplates?: unknown
}): Promise<EditorActionsFace> {
  const { state, dispatch, locks } = overrides
  const noop = vi.fn()
  return renderHookFace(() => useEditorActions(
    state,
    dispatch as never,
    noop as never,
    noop as never,
    zh,
    {} as never,
    (overrides.flowTemplates ?? {}) as never,
    (overrides.templates ?? {}) as never,
    {} as never,
    {} as never,
    async () => null,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    { locks },
  ))
}

// ---------------------------------------------------------------------------
// ① 运行中保存实例：二次确认
// ---------------------------------------------------------------------------

describe('运行中保存实例的二次确认（需求 b）', () => {
  it('运行中保存 → 弹确认（提示会改变父代理后续编排），未确认不落库', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const saveWorkflow = vi.fn(async (flow: WorkflowDocument): Promise<WorkflowDocument | null> => flow)
    const face = await renderDocument({ state, dispatch, saveWorkflow })

    await act(async () => {
      await face.saveCanvas()
    })

    const confirmActions = dispatch.mock.calls.map(([action]) => action as { type: string; confirm?: { title?: string; message?: string; confirmLabel?: string } })
      .filter((action) => action.type === 'CONFIRM_SET' && action.confirm)
    expect(confirmActions).toHaveLength(1)
    expect(confirmActions[0]?.confirm?.title).toBe(zh.saveRunningTitle)
    expect(confirmActions[0]?.confirm?.message).toBe(zh.saveRunningMessage)
    expect(confirmActions[0]?.confirm?.confirmLabel).toBe(zh.saveRunningConfirm)
    // 未确认前不得落库
    expect(saveWorkflow).not.toHaveBeenCalled()
  })

  it('确认后落库并记录已保存快照', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const saveWorkflow = vi.fn(async (flow: WorkflowDocument): Promise<WorkflowDocument | null> => ({ ...flow, revision: 2 }))
    const face = await renderDocument({ state, dispatch, saveWorkflow })

    await act(async () => {
      await face.saveCanvas()
    })
    const confirm = dispatch.mock.calls
      .map(([action]) => action as { type: string; confirm?: { onConfirm?: () => void } })
      .find((action) => action.type === 'CONFIRM_SET' && action.confirm)?.confirm
    await act(async () => {
      confirm?.onConfirm?.()
      await Promise.resolve()
    })

    expect(saveWorkflow).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'MARK_SAVED')).toBe(true)
  })

  it('非运行中保存：不弹确认，直接落库', async () => {
    const { state } = runningState()
    const idle: StudioState = { ...state, activeRuns: [] }
    const dispatch = vi.fn()
    const saveWorkflow = vi.fn(async (flow: WorkflowDocument): Promise<WorkflowDocument | null> => ({ ...flow, revision: 2 }))
    const face = await renderDocument({ state: idle, dispatch, saveWorkflow })

    await act(async () => {
      await face.saveCanvas()
    })
    expect(saveWorkflow).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
  })

  it('运行中但无未保存改动（纯拖动已自动落库）：不弹确认，直接保存', async () => {
    const { state } = runningState()
    const clean: StudioState = { ...state, dirty: false }
    const dispatch = vi.fn()
    const saveWorkflow = vi.fn(async (flow: WorkflowDocument): Promise<WorkflowDocument | null> => ({ ...flow, revision: 2 }))
    const face = await renderDocument({ state: clean, dispatch, saveWorkflow })

    await act(async () => {
      await face.saveCanvas()
    })
    // 无改动 → 无确认框（避免无意义确认/注入）；保存本身照常执行
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
    expect(saveWorkflow).toHaveBeenCalledTimes(1)
  })

  it('自动保存（auto）在运行中同样不弹确认、不 toast 成功', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const notify = vi.fn()
    const saveWorkflow = vi.fn(async (flow: WorkflowDocument): Promise<WorkflowDocument | null> => ({ ...flow, revision: 2 }))
    const face = await renderDocument({ state, dispatch, saveWorkflow, notify })

    await act(async () => {
      await face.saveCanvas({ auto: true })
    })
    expect(saveWorkflow).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ② 纯几何拖动：防抖自动保存
// ---------------------------------------------------------------------------

describe('纯 XY 拖动 / 组卡片缩放：防抖自动保存（需求 2 补充裁决）', () => {
  it('节点拖动 → NODE_MOVED + 防抖后静默保存一次', async () => {
    vi.useFakeTimers()
    const { state } = runningState()
    const dispatch = vi.fn()
    const notify = vi.fn()
    const saveCanvas = vi.fn(async () => null)
    const face = await renderCanvas({ state, dispatch, notify, saveCanvas })

    await act(async () => {
      face.moveNode('n-next', { x: 12, y: 34 })
    })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'NODE_MOVED')).toBe(true)
    // 防抖窗口内不保存（避免拖动过程刷请求）
    expect(saveCanvas).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS)
      await Promise.resolve()
    })
    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(saveCanvas).toHaveBeenCalledWith({ auto: true })
  })

  it('连续拖动合并为一次保存（防抖生效）', async () => {
    vi.useFakeTimers()
    const { state } = runningState()
    const saveCanvas = vi.fn(async () => null)
    const face = await renderCanvas({ state, dispatch: vi.fn(), notify: vi.fn(), saveCanvas })

    await act(async () => {
      face.moveNode('n-next', { x: 1, y: 1 })
      face.moveNode('n-next', { x: 2, y: 2 })
      face.moveNode('n-next', { x: 3, y: 3 })
    })
    await act(async () => {
      vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS)
      await Promise.resolve()
    })
    expect(saveCanvas).toHaveBeenCalledTimes(1)
  })

  it('协作组卡片缩放 → 同样防抖自动保存', async () => {
    vi.useFakeTimers()
    const { state } = runningState()
    const saveCanvas = vi.fn(async () => null)
    const face = await renderCanvas({ state, dispatch: vi.fn(), notify: vi.fn(), saveCanvas })

    await act(async () => {
      face.onGroupResize('n-next', { w: 400, h: 300 })
    })
    await act(async () => {
      vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS)
      await Promise.resolve()
    })
    expect(saveCanvas).toHaveBeenCalledTimes(1)
  })

  it('草稿态（_draft）拖动：不自动落库（须手动保存/创建实例）', async () => {
    vi.useFakeTimers()
    const { state } = runningState()
    const draft: StudioState = {
      ...state,
      currentKind: 'workflow',
      workflows: [{ ...state.workflows[0]!, _draft: true } as unknown as StudioState['workflows'][number]],
    }
    const saveCanvas = vi.fn(async () => null)
    const face = await renderCanvas({ state: draft, dispatch: vi.fn(), notify: vi.fn(), saveCanvas })

    await act(async () => {
      face.moveNode('n-next', { x: 5, y: 5 })
    })
    await act(async () => {
      vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS)
      await Promise.resolve()
    })
    expect(saveCanvas).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ③ 运行中画布锁定 + 取消清空/节点删除二次确认
// ---------------------------------------------------------------------------

describe('运行中画布锁定（需求 c）', () => {
  it('已完成节点：删除被静默忽略（不发 NODE_REMOVED、无 toast）', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const notify = vi.fn()
    const face = await renderCanvas({
      state: { ...state, selection: { nodeId: 'n-done', edgeId: null, lib: null } },
      dispatch,
      notify,
      saveCanvas: vi.fn(async () => null),
    })

    await act(async () => { face.removeSelected() })
    expect(dispatch).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('执行中节点：同样不可删除（其左入口流程已在进行）', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const face = await renderCanvas({
      state: { ...state, selection: { nodeId: 'n-run', edgeId: null, lib: null } },
      dispatch,
      notify: vi.fn(),
      saveCanvas: vi.fn(async () => null),
    })
    await act(async () => { face.removeSelected() })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('未执行节点：可直接删除（不再二次确认）', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const face = await renderCanvas({
      state: { ...state, selection: { nodeId: 'n-next', edgeId: null, lib: null } },
      dispatch,
      notify: vi.fn(),
      saveCanvas: vi.fn(async () => null),
    })
    await act(async () => { face.removeSelected() })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'NODE_REMOVED')).toBe(true)
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
  })

  it('已完成节点连线 / 执行中节点左入口连线：删除被忽略', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const face = await renderCanvas({ state, dispatch, notify: vi.fn(), saveCanvas: vi.fn(async () => null) })

    await act(async () => { face.removeLine('e-done-out') })
    await act(async () => { face.removeLine('e-run-in') })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('自由连线（执行中节点右出到后续）：可正常删除', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    // 追加一条 n-run 的出线（不受锁）：应可删除；同时被锁的 e-run-in 必须删不掉
    const withFree: StudioState = {
      ...state,
      canvas: { ...state.canvas, edges: [...state.canvas.edges, edge('e-free', 'n-run', 'n-next')] },
    }
    const face = await renderCanvas({ state: withFree, dispatch, notify: vi.fn(), saveCanvas: vi.fn(async () => null) })
    await act(async () => { face.removeLine('e-run-in') })
    await act(async () => { face.removeLine('e-free') })
    expect(dispatch.mock.calls.filter(([action]) => (action as { type: string }).type === 'EDGE_REMOVED')).toHaveLength(1)
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string; id?: string }).type === 'EDGE_REMOVED' && (action as { id?: string }).id === 'e-free')).toBe(true)
  })

  it('连线到已完成/执行中节点：拒绝并沿用「无效连线」提示', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const notify = vi.fn()
    const face = await renderCanvas({ state, dispatch, notify, saveCanvas: vi.fn(async () => null) })

    await act(async () => {
      face.onConnect({ source: 'n-run', target: 'n-done', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    })
    expect(notify).toHaveBeenCalledWith('error', zh.invalidConnection)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('清空画布：不再二次确认，直接清空（可撤销）', async () => {
    const { state } = runningState()
    const dispatch = vi.fn()
    const face = await renderCanvas({ state, dispatch, notify: vi.fn(), saveCanvas: vi.fn(async () => null) })

    await act(async () => { face.clearGraph() })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
    const replaced = dispatch.mock.calls.map(([action]) => action as { type: string; nodes?: unknown[] })
      .find((action) => action.type === 'GRAPH_REPLACED')
    expect(replaced?.nodes).toEqual([])
  })

  it('锁定节点拖入协作组：被忽略（入组会断开其流程连线，等于改写已跑完流程）', async () => {
    const { state } = runningState()
    const groupNode = { id: 'g-1', kind: 'group' as const, position: { x: 0, y: 0 }, data: { label: '组', collabPrompt: '', memberIds: [], size: { w: 300, h: 220 } } }
    const withGroup: StudioState = { ...state, canvas: { nodes: [...state.canvas.nodes, groupNode], edges: state.canvas.edges } }
    const dispatch = vi.fn()
    const face = await renderCanvas({ state: withGroup, dispatch, notify: vi.fn(), saveCanvas: vi.fn(async () => null) })

    await act(async () => { face.addNodeToGroup('n-done', 'g-1') })
    expect(dispatch).not.toHaveBeenCalled()
    // 未锁节点入组照常生效
    await act(async () => { face.addNodeToGroup('n-next', 'g-1') })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'GRAPH_REPLACED')).toBe(true)
  })

  it('锁定成员移出协作组：被忽略', async () => {
    const { state } = runningState()
    const member = { ...state.canvas.nodes[0]!, data: { ...state.canvas.nodes[0]!.data, groupId: 'g-1' } }
    const groupNode = { id: 'g-1', kind: 'group' as const, position: { x: 0, y: 0 }, data: { label: '组', collabPrompt: '', memberIds: ['n-done'], size: { w: 300, h: 220 } } }
    const withGroup: StudioState = { ...state, canvas: { nodes: [member, state.canvas.nodes[1]!, state.canvas.nodes[2]!, groupNode], edges: state.canvas.edges } }
    const dispatch = vi.fn()
    const face = await renderCanvas({ state: withGroup, dispatch, notify: vi.fn(), saveCanvas: vi.fn(async () => null) })
    await act(async () => { face.removeGroupMember('n-done') })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('被锁连线字段编辑：即使编辑器仍指向该连线也被忽略（防运行前已选中的旁路）', async () => {
    const { state, nodes, edges } = runningState()
    const locks = computeRunLocks({ enabled: true, nodes, edges, statusByNode: { 'n-done': 'ok', 'n-run': 'running' } })
    const dispatch = vi.fn()

    const lockedEditor: StudioState = { ...state, editor: { source: 'edge', id: 'e-done-out' } }
    const face = await renderEditorFace({ state: lockedEditor, dispatch, locks })
    await act(async () => { face.patchEditor({ condition: { type: 'content', label: 'x' } }) })
    expect(dispatch).not.toHaveBeenCalled()

    const freeEditor: StudioState = { ...state, editor: { source: 'edge', id: 'e-free' } }
    const face2 = await renderEditorFace({ state: freeEditor, dispatch, locks })
    await act(async () => { face2.patchEditor({ condition: { type: 'content', label: 'x' } }) })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'EDGE_PATCH')).toBe(true)
  })

  it('整理布局（批量坐标）：同样防抖自动保存', async () => {
    vi.useFakeTimers()
    const { state } = runningState()
    const saveCanvas = vi.fn(async () => null)
    const face = await renderCanvas({ state, dispatch: vi.fn(), notify: vi.fn(), saveCanvas })

    await act(async () => { face.tidyGraph() })
    await act(async () => {
      vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS)
      await Promise.resolve()
    })
    expect(saveCanvas).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// ④ 取消二次确认（用户裁决清单）
// ---------------------------------------------------------------------------

describe('取消二次确认：模板删除直接执行（用户裁决 2026-02）', () => {
  /** 全解锁（模板删除与运行锁定无关）。 */
  const unlocked = computeRunLocks({ enabled: false, nodes: [], edges: [], statusByNode: {} })

  it('删除角色模板：不再弹确认，直接调用后端删除', async () => {
    const state: StudioState = {
      ...createInitialState('s-1'),
      editor: { source: 'template', kind: 'role', id: 'r-1' },
      templates: { role: [{ id: 'r-1', kind: 'agent', name: '研究员' }], file: [], database: [], group: [] } as unknown as StudioState['templates'],
    }
    const dispatch = vi.fn()
    const deleteTemplate = vi.fn(async () => {})
    const face = await renderEditorFace({ state, dispatch, locks: unlocked, templates: { deleteTemplate } })

    await act(async () => {
      await face.deleteEditor()
    })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
    expect(deleteTemplate).toHaveBeenCalledWith('role', 'r-1')
  })

  it('删除工作流模板：不再弹确认，直接调用后端删除并清空画布', async () => {
    const state: StudioState = {
      ...createInitialState('s-1'),
      editor: { source: 'flowTemplate', id: 't-1' },
      flowTemplates: [{ id: 't-1', mode: 'mode1', name: '模板', description: '', nodes: [], lines: [] }],
    }
    const dispatch = vi.fn()
    const deleteFlowTemplate = vi.fn(async () => {})
    const face = await renderEditorFace({ state, dispatch, locks: unlocked, flowTemplates: { deleteFlowTemplate } })

    await act(async () => {
      await face.deleteEditor()
      await Promise.resolve()
    })
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CONFIRM_SET')).toBe(false)
    expect(deleteFlowTemplate).toHaveBeenCalledWith('t-1')
    expect(dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CLEAR_CANVAS')).toBe(true)
  })
})
