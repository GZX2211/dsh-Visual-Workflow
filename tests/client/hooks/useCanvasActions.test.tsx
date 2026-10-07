// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useCanvasActions.test.tsx
//
// 画布编辑面的资产分支（资产态改造）：
//   ① 角色资产拖入画布 → 生成内联角色节点并写入 data.sourceAssetId（深拷贝解耦）；
//      父代理资产沿用「每画布最多一个父代理」约束；无当前文档时不放置；
//   ② 几何自动保存：资产态不自动落库（版本是显式动作），模版态仍静默落库（回归）。
//
// 依赖缝：hook 级装配（fake state + dispatch 收集 + fake saveCanvas），不依赖远端。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useCanvasActions, GEOMETRY_AUTOSAVE_DEBOUNCE_MS, type CanvasActionsFace } from '../../../src/client/hooks/useCanvasActions.js'
import { computeRunLocks } from '../../../src/client/lib/run-locks.js'
import { createInitialState, type StudioAction, type StudioState } from '../../../src/client/studio/studio-state.js'
import type { GraphHistoryFace } from '../../../src/client/hooks/useGraphHistory.js'
import type { RoleAssetDetail } from '../../../src/host/shared/asset-types.js'
import { en, zh } from '../../../src/client/i18n.js'

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

function roleAsset(partial: Partial<RoleAssetDetail> = {}): RoleAssetDetail {
  return {
    assetId: 'a-r1',
    versionId: 1,
    rowId: 'row-1',
    kind: 'agent',
    roleAssetType: 'standalone',
    name: '资产角色',
    systemPrompt: '你是资产角色',
    provider: 'deepseek',
    model: 'deepseek-chat',
    retryLimit: 3,
    referenceWorkflowIds: [],
    createdAt: 1,
    ...partial,
  }
}

/** 资产态状态夹具（当前画布 = 工作流资产文档）。 */
function assetState(nodes: StudioState['canvas']['nodes'] = []): StudioState {
  return {
    ...createInitialState('s-1'),
    librarySource: 'asset',
    currentKind: 'flowAsset',
    currentId: 'a-1',
    assetDoc: {
      assetId: 'a-1', versionId: 1, rowId: 'row-1', mode: 'mode1', name: '资产一', description: '',
      nodes: [], lines: [], roleVersionIds: [], createdAt: 1,
    },
    canvas: { nodes, edges: [] },
  }
}

interface CanvasHarness {
  face: CanvasActionsFace
  dispatched: Array<{ type: string; [key: string]: unknown }>
  toasts: Array<{ kind: string; text: string }>
  saveCanvas: ReturnType<typeof vi.fn>
}

async function renderCanvas(state: StudioState, copy = zh): Promise<CanvasHarness> {
  const dispatched: Array<{ type: string; [key: string]: unknown }> = []
  const toasts: Array<{ kind: string; text: string }> = []
  const saveCanvas = vi.fn(async () => null)
  const dispatch = ((action: { type: string }) => { dispatched.push(action) }) as never
  const notify = (kind: 'info' | 'success' | 'error', text: string): void => { toasts.push({ kind, text }) }
  const locks = computeRunLocks({ enabled: false, nodes: [], edges: [], statusByNode: {} })
  const history = { remember: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false } as unknown as GraphHistoryFace
  let face: CanvasActionsFace | null = null
  function Harness(): null {
    const f = useCanvasActions(state, dispatch, notify as never, history, copy, { locks, saveCanvas })
    useEffect(() => { face = f }, [f])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { face: face!, dispatched, toasts, saveCanvas }
}

describe('角色资产拖入画布（placeRoleAssetNode）', () => {
  it('子代理资产 → 内联角色节点 + data.sourceAssetId（深拷贝解耦）', async () => {
    const h = await renderCanvas(assetState())
    await act(async () => { h.face.placeRoleAssetNode(roleAsset(), { x: 40, y: 60 }) })
    const added = h.dispatched.find((action) => action.type === 'NODE_ADDED')
    expect(added).toBeTruthy()
    const node = added!.node as { kind: string; position: { x: number; y: number }; data: Record<string, unknown> }
    expect(node.kind).toBe('agent')
    expect(node.position).toEqual({ x: 40, y: 60 })
    expect(node.data.sourceAssetId).toBe('a-r1')
    expect(node.data.label).toBe('资产角色')
    expect(node.data.systemPrompt).toBe('你是资产角色')
    // 放置后选中新节点 + 成功提示
    expect(h.dispatched.some((action) => action.type === 'SELECT_NODE')).toBe(true)
    expect(h.toasts).toEqual([{ kind: 'success', text: zh.toastNodeAdded }])
  })

  it('父代理资产 → 生成 parent 节点；画布已有父代理时拒绝并提示', async () => {
    const h = await renderCanvas(assetState())
    await act(async () => { h.face.placeRoleAssetNode(roleAsset({ kind: 'parent' }), { x: 0, y: 0 }) })
    const added = h.dispatched.find((action) => action.type === 'NODE_ADDED')
    expect((added!.node as { kind: string }).kind).toBe('parent')

    const withParent = await renderCanvas(assetState([{ id: 'p-1', kind: 'parent', position: { x: 0, y: 0 }, data: {} }]))
    await act(async () => { withParent.face.placeRoleAssetNode(roleAsset({ kind: 'parent' }), { x: 0, y: 0 }) })
    expect(withParent.dispatched.some((action) => action.type === 'NODE_ADDED')).toBe(false)
    expect(withParent.toasts).toEqual([{ kind: 'error', text: zh.parentDuplicatedHint }])
  })

  it('无当前文档（画布未打开）→ 不放置、不提示', async () => {
    const state: StudioState = { ...assetState(), currentId: null, currentKind: null }
    const h = await renderCanvas(state)
    await act(async () => { h.face.placeRoleAssetNode(roleAsset(), { x: 0, y: 0 }) })
    expect(h.dispatched).toEqual([])
    expect(h.toasts).toEqual([])
  })
})

describe('localized stage defaults', () => {
  it('test_new_stage_uses_current_copy_and_preserves_existing_saved_labels', async () => {
    const existing = { id: 'agent-1', kind: 'agent' as const, position: { x: 0, y: 0 }, data: { label: 'Saved agent name' } }
    const state = { ...assetState([existing]), mode: 'mode2' as const }
    const h = await renderCanvas(state, en)
    await act(async () => { h.face.placeStageNode('start', { x: 40, y: 60 }) })
    const added = h.dispatched.find((action) => action.type === 'NODE_ADDED')
    expect((added?.node as { data: { label: string } }).data.label).toBe(en.nodeKinds.input)
    expect(existing.data.label).toBe('Saved agent name')
  })
})

describe('几何自动保存（资产态不自动落库）', () => {
  it('资产态：节点拖动不触发自动保存（版本必须显式登记）', async () => {
    vi.useFakeTimers()
    const h = await renderCanvas(assetState())
    await act(async () => { h.face.moveNode('n-1', { x: 5, y: 5 }) })
    await act(async () => { vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS + 10) })
    expect(h.saveCanvas).not.toHaveBeenCalled()
    expect(h.dispatched.some((action) => action.type === 'NODE_MOVED')).toBe(true)
  })

  it('模版态（非草稿）：节点拖动仍静默自动保存（回归）', async () => {
    vi.useFakeTimers()
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 'tpl-1',
      flowTemplates: [{ id: 'tpl-1', mode: 'mode1', name: '模板', description: '', nodes: [], lines: [] }],
    }
    const h = await renderCanvas(state)
    await act(async () => { h.face.moveNode('n-1', { x: 5, y: 5 }) })
    await act(async () => { vi.advanceTimersByTime(GEOMETRY_AUTOSAVE_DEBOUNCE_MS + 10) })
    expect(h.saveCanvas).toHaveBeenCalledWith({ auto: true })
  })
})
