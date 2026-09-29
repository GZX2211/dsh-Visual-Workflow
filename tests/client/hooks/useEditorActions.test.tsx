// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useEditorActions.test.tsx
//
// useEditorActions（hooks/useEditorActions.ts）单测：
//   ① P4 父模板保存路径：saveEditor 对 source='template' 只调模板库接口保存，不派发实例变更；
//   ② 删除落库后的画布归属校验（缺陷修复：删除在途切文档会误清新文档的画布）——
//      在途期间已切到别的文档 → 只移除列表项、绝不清新文档画布；未切走 → 清空一次；
//   ③ 模版 → 资产入库：锁定判据（纯函数）、先保存后 promote、unchanged 与重复入库分支；
//   ④ 资产态保存（登记新版本）/ 回滚 / 退役，以及未保存守卫「保存并继续」的接续。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——useEditorActions 用例归入本文件。
// （运行锁定路径下 useEditorActions 的旁路拦截用例见 hooks/canvas-lock-and-autosave.test.tsx）

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import {
  useEditorActions, isPromoteLocked, promoteLockedOf, promoteTargetOf, type EditorActionsFace,
} from '../../../src/client/hooks/useEditorActions.js'
import { useAssets, type AssetsFace } from '../../../src/client/hooks/useAssets.js'
import { useUnsavedGuard, type UnsavedGuardFace } from '../../../src/client/hooks/useUnsavedGuard.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import { studioReducer } from '../../../src/client/studio/studio-reducer.js'
import { zh } from '../../../src/client/i18n.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { RemoteError } from '../../../src/client/lib/remote.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
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
  assets?: unknown
  selection?: unknown
  remote?: unknown
  saveCanvas?: unknown
} = {}): Promise<{
  face: EditorActionsFace
  dispatched: StudioAction[]
  toasts: Array<{ kind: string; text: string }>
  rerender: (next: StudioState) => Promise<void>
}> {
  const dispatched: StudioAction[] = []
  const toasts: Array<{ kind: string; text: string }> = []
  let face: EditorActionsFace | null = null
  function Probe({ current }: { current: StudioState }): null {
    face = useEditorActions(
      current,
      ((action: StudioAction) => { dispatched.push(action) }) as never,
      ((kind: 'info' | 'success' | 'error', text: string) => { toasts.push({ kind, text }) }) as never,
      (() => {}) as never,
      zh,
      (deps.workflows ?? {}) as never,
      (deps.flowTemplates ?? {}) as never,
      (deps.templates ?? {}) as never,
      (deps.assets ?? {}) as never,
      (deps.selection ?? {}) as never,
      (deps.remote ?? {}) as never,
      (deps.saveCanvas ?? (async () => null)) as never,
      (() => {}) as never,
      (() => {}) as never,
      (() => {}) as never,
      (() => {}) as never,
      unlocked,
    )
    return null
  }
  await act(async () => {
    // 同一用例内二次装配（换假远端重跑）时必须先卸载旧根，否则容器里残留两份界面
    if (root) { root.unmount(); root = null }
    root = createRoot(container!)
    root.render(React.createElement(Probe, { current: state }))
  })
  return {
    face: face!,
    dispatched,
    toasts,
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

// ---------------------------------------------------------------------------
// 资产态（模版 → 资产入库 / 资产态保存 / 回滚 / 退役）夹具与装配
// ---------------------------------------------------------------------------

/** 调用记录 + 可编排响应的假远端面（与 useAssets 用例同口径）。 */
function makeRemote(handler: (endpoint: string, args: Record<string, unknown>) => unknown): {
  remote: RemoteFace
  calls: Array<{ endpoint: string; args: Record<string, unknown> }>
} {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const remote: RemoteFace = {
    stream: vi.fn(async () => undefined),
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      const safe = args ?? {}
      calls.push({ endpoint, args: safe })
      return handler(endpoint, safe)
    }),
  }
  return { remote, calls }
}

/** 稳定错误码错误（模拟网络边界抛出的业务失败）。 */
function remoteError(message: string, code: string): RemoteError {
  const error = new Error(message) as RemoteError
  error.code = code
  return error
}

/** 工作流资产 Active 详情夹具（画布打开态）。 */
const WORKFLOW_DETAIL = {
  assetId: 'a-1', versionId: 2, rowId: 'a-1@2', mode: 'mode1', name: '资产一', description: '资产描述',
  nodes: [{ id: 'n-old', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '旧' } }],
  lines: [], roleVersionIds: [], createdAt: 1,
}

/**
 * 角色资产 Active 详情夹具（字段域与 RoleAssetDetail 一致）。
 * `referencingWorkflowAssets` 是归档/级联确认框的影响面事实来源（按资产聚合去重，
 * 不取单版本行的 referenceWorkflowIds——后者新版本从零开始，会显示成「被 0 个工作流引用」）。
 */
const ROLE_DETAIL = {
  assetId: 'a-r1', versionId: 1, rowId: 'a-r1@1', kind: 'agent', roleAssetType: 'shared',
  name: '资产角色', systemPrompt: '提示词', provider: 'deepseek', model: 'deepseek-chat',
  reasoning: 'high', presetId: 'standard', retryLimit: 5, reactLimit: 7,
  inputSchema: 'in', outputSchema: 'out',
  systemPromptSource: 'a.md', injectSystemPrompt: false, injectToolSections: true,
  promptFilePath: 'D:\\p.md', referenceWorkflowIds: ['a-1@1', 'a-2@1'], createdAt: 1,
  referencingWorkflowAssets: [
    { assetId: 'a-1', name: '资产一', versionCount: 2 },
    { assetId: 'a-2', name: '资产二', versionCount: 1 },
  ],
}

/** shared 角色资产归档确认框的完整期望文案（影响面 = 资产名清单）。 */
function sharedRetireMessageOf(count: string, names: string): string {
  return zh.assetRetireSharedMessage.replace('{count}', count).replace('{names}', names)
}

/** 资产态集成装配：真实 useAssets + useUnsavedGuard + useEditorActions（共用一份假远端）。 */
interface AssetHarness {
  editor: EditorActionsFace
  guard: UnsavedGuardFace
  assets: AssetsFace
  dispatched: StudioAction[]
  toasts: Array<{ kind: string; text: string }>
  errors: unknown[]
  rerender(next: StudioState): Promise<void>
}

async function renderAssetHarness(state: StudioState, deps: {
  remote: RemoteFace
  workflows?: unknown
  flowTemplates?: unknown
  templates?: unknown
  saveCanvas?: unknown
}): Promise<AssetHarness> {
  const dispatched: StudioAction[] = []
  const toasts: Array<{ kind: string; text: string }> = []
  const errors: unknown[] = []
  let editor: EditorActionsFace | null = null
  let guard: UnsavedGuardFace | null = null
  let assets: AssetsFace | null = null
  const noop = (): void => {}
  function Probe({ current }: { current: StudioState }): null {
    const dispatch = ((action: StudioAction) => { dispatched.push(action) }) as never
    const notify = ((kind: 'info' | 'success' | 'error', text: string) => { toasts.push({ kind, text }) }) as never
    const toastError = ((error: unknown) => { errors.push(error) }) as never
    const a = useAssets(deps.remote, dispatch, notify, toastError, zh, current)
    const g = useUnsavedGuard(current, dispatch)
    const e = useEditorActions(
      current, dispatch, notify, toastError, zh,
      (deps.workflows ?? {}) as never,
      (deps.flowTemplates ?? {}) as never,
      (deps.templates ?? {}) as never,
      a,
      {} as never,
      deps.remote,
      (deps.saveCanvas ?? (async () => null)) as never,
      noop, noop, noop, noop,
      unlocked,
    )
    useEffect(() => { assets = a; guard = g; editor = e }, [a, g, e])
    return null
  }
  const render = async (next: StudioState): Promise<void> => {
    await act(async () => {
      if (root) { root.unmount(); root = null }
      root = createRoot(container!)
      root.render(React.createElement(Probe, { current: next }))
    })
  }
  await render(state)
  return {
    get editor() { return editor! },
    get guard() { return guard! },
    get assets() { return assets! },
    dispatched,
    toasts,
    errors,
    rerender: async (next: StudioState) => {
      await act(async () => { root!.render(React.createElement(Probe, { current: next })) })
    },
  }
}

/** 打开在画布上的工作流资产态（画布含一个未保存的新节点）。 */
function flowAssetState(overrides: Partial<StudioState> = {}): StudioState {
  const node: CanvasNode = { id: 'n-new', kind: 'agent', position: { x: 10, y: 20 }, data: { label: '新' } }
  return {
    ...createInitialState('s-1'),
    currentKind: 'flowAsset',
    currentId: 'a-1',
    editor: { source: 'flowAsset', id: 'a-1' },
    assetDoc: WORKFLOW_DETAIL as never,
    canvas: { nodes: [node], edges: [] },
    dirty: true,
    ...overrides,
  }
}

/** 属性栏编辑中的角色资产态（不在画布上）。 */
function roleAssetState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    ...createInitialState('s-1'),
    editor: { source: 'roleAsset', id: 'a-r1' },
    assetRoleDoc: ROLE_DETAIL as never,
    ...overrides,
  }
}

/**
 * 画布角色节点态（绑定来源角色资产 a-r1）。
 * `bound=false` 模拟从模版/实例拖入的内联节点（没有 sourceAssetId → 无回滚对象）。
 */
function roleNodeState(options: { bound?: boolean } = {}): StudioState {
  const node: CanvasNode = {
    id: 'n-role',
    kind: 'agent',
    position: { x: 5, y: 6 },
    data: {
      label: '旧名',
      systemPrompt: '旧提示词',
      provider: 'deepseek',
      model: 'deepseek-chat',
      retryLimit: 2,
      groupId: 'g-1',
      ...(options.bound === false ? {} : { sourceAssetId: 'a-r1' }),
    },
  }
  return {
    ...createInitialState('s-1'),
    editor: { source: 'node', id: 'n-role' },
    canvas: { nodes: [node], edges: [] },
  }
}

/** 资产写入端点的固定响应（列表端点返回空列表）。 */
function assetWriteRemote(write: { endpoint: string; value: unknown }): ReturnType<typeof makeRemote> {
  return makeRemote((endpoint) => {
    if (endpoint === write.endpoint) return write.value
    if (endpoint === EP.EP_GET_ASSET) return WORKFLOW_DETAIL
    return { workflows: [], roles: [] }
  })
}

describe('模版 → 资产入库：目标与锁定判据（纯函数）', () => {
  const base = createInitialState('s-1')

  it('promoteTargetOf：工作流模版 → workflow、角色模版 → role；其余编辑器无入库目标', () => {
    expect(promoteTargetOf({ ...base, editor: { source: 'flowTemplate', id: 'tpl-1' } }))
      .toEqual({ kind: 'workflow', templateId: 'tpl-1' })
    expect(promoteTargetOf({ ...base, editor: { source: 'template', kind: 'role', id: 'r-1' } }))
      .toEqual({ kind: 'role', templateId: 'r-1' })
    // 文件/数据库/协作组模板不提供入库；实例态与资产态同样没有入库目标
    expect(promoteTargetOf({ ...base, editor: { source: 'template', kind: 'file', id: 'f-1' } })).toBeNull()
    expect(promoteTargetOf({ ...base, editor: { source: 'workflow', id: 'wf-1' } })).toBeNull()
    expect(promoteTargetOf({ ...base, editor: { source: 'flowAsset', id: 'a-1' } })).toBeNull()
    expect(promoteTargetOf(base)).toBeNull()
  })

  it('isPromoteLocked：模版绑定 + 指纹相同 → 锁定（模版未再修改）', () => {
    const summaries = [{ sourceTemplateId: 'tpl-1', sourceFingerprint: 'fp-1', currentTemplateFingerprint: 'fp-1' }]
    expect(isPromoteLocked(summaries, 'tpl-1')).toBe(true)
  })

  it('isPromoteLocked：模版内容已变化（指纹不同）→ 未锁定', () => {
    const summaries = [{ sourceTemplateId: 'tpl-1', sourceFingerprint: 'fp-1', currentTemplateFingerprint: 'fp-2' }]
    expect(isPromoteLocked(summaries, 'tpl-1')).toBe(false)
  })

  it('isPromoteLocked：无绑定 / 模版已删除（指纹缺失）→ 未锁定', () => {
    expect(isPromoteLocked([], 'tpl-1')).toBe(false)
    expect(isPromoteLocked([{ sourceTemplateId: 'tpl-other', sourceFingerprint: 'fp-1', currentTemplateFingerprint: 'fp-1' }], 'tpl-1')).toBe(false)
    expect(isPromoteLocked([{ sourceTemplateId: 'tpl-1', sourceFingerprint: 'fp-1' }], 'tpl-1')).toBe(false)
  })

  it('promoteLockedOf：按当前编辑器的模版种类取对应资产列表判定', () => {
    const assets = {
      workflows: [{ assetId: 'a-1', versionId: 1, name: '工作流资产', description: '', sourceTemplateId: 'tpl-1', sourceFingerprint: 'fp', currentTemplateFingerprint: 'fp', updatedAt: 1 }],
      roles: [{ assetId: 'a-r1', versionId: 1, name: '角色资产', kind: 'agent' as const, roleAssetType: 'standalone' as const, sourceTemplateId: 'r-1', sourceFingerprint: 'fp', currentTemplateFingerprint: 'fp-2', updatedAt: 1 }],
      retiredWorkflows: [],
      retiredRoles: [],
    }
    expect(promoteLockedOf({ ...base, editor: { source: 'flowTemplate', id: 'tpl-1' }, assets })).toBe(true)
    expect(promoteLockedOf({ ...base, editor: { source: 'template', kind: 'role', id: 'r-1' }, assets })).toBe(false)
  })
})

describe('模版 → 资产入库：编排（先保存，保存未落库即中止）', () => {
  it('工作流模版：先落模版（画布保存）再 promoteAsset，成功提示已入库', async () => {
    const order: string[] = []
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_PROMOTE_ASSET) { order.push('promote'); return { assetId: 'a-1', versionId: 1, rowId: 'a-1@1', unchanged: false } }
      return { workflows: [], roles: [] }
    })
    const saveCanvas = vi.fn(async () => { order.push('save'); return { id: 'tpl-1' } })
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 'tpl-1',
      editor: { source: 'flowTemplate', id: 'tpl-1' },
    }
    const harness = await renderAssetHarness(state, { remote, saveCanvas })

    await act(async () => { await harness.editor.promoteEditor() })

    expect(order).toEqual(['save', 'promote'])
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PROMOTE_ASSET, EP.EP_LIST_ASSETS])
    expect(calls[0]!.args).toEqual({ kind: 'workflow', templateId: 'tpl-1' })
    expect(harness.toasts.map((toast) => toast.text)).toEqual([zh.toastAssetPromoted.replace('{id}', 'a-1').replace('{version}', '1')])
  })

  it('保存未落库（saveCanvas 返回 null）→ 中止，不调 promoteAsset', async () => {
    const { remote, calls } = makeRemote(() => ({ workflows: [], roles: [] }))
    const saveCanvas = vi.fn(async () => null)
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 'tpl-1',
      editor: { source: 'flowTemplate', id: 'tpl-1' },
    }
    const harness = await renderAssetHarness(state, { remote, saveCanvas })

    await act(async () => { await harness.editor.promoteEditor() })

    expect(saveCanvas).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([])
    expect(harness.toasts).toEqual([])
  })

  it('角色模版：先落模板库再 promoteAsset(kind=role)；保存失败不入库', async () => {
    const roleTemplate = { id: 'r-1', kind: 'agent', name: '角色', systemPrompt: '提示词' }
    const state: StudioState = {
      ...createInitialState('s-1'),
      editor: { source: 'template', kind: 'role', id: 'r-1' },
      templates: { ...createInitialState('s-1').templates, role: [roleTemplate as never] },
    }
    const saveTemplate = vi.fn(async () => {})
    const first = makeRemote(() => ({ assetId: 'a-r1', versionId: 1, rowId: 'a-r1@1', unchanged: false, roleAssetType: 'standalone' }))
    const harness = await renderAssetHarness(state, { remote: first.remote, templates: { saveTemplate } })

    await act(async () => { await harness.editor.promoteEditor() })

    expect(saveTemplate).toHaveBeenCalledWith('role', roleTemplate)
    expect(first.calls[0]).toEqual({ endpoint: EP.EP_PROMOTE_ASSET, args: { kind: 'role', templateId: 'r-1' } })

    // 保存失败（模板库抛错）：中止入库且不静默吞错
    const failure = new Error('put failed')
    const second = await renderAssetHarness(state, {
      remote: makeRemote(() => ({ workflows: [], roles: [] })).remote,
      templates: { saveTemplate: vi.fn(async () => { throw failure }) },
    })
    await act(async () => { await second.editor.promoteEditor() })
    expect(second.errors).toEqual([failure])
  })

  it('后端幂等短路（unchanged）→ 只提示「内容未变化，未新增版本」，不谎报已入库', async () => {
    const { remote } = assetWriteRemote({ endpoint: EP.EP_PROMOTE_ASSET, value: { assetId: 'a-1', versionId: 1, rowId: 'a-1@1', unchanged: true } })
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 'tpl-1',
      editor: { source: 'flowTemplate', id: 'tpl-1' },
    }
    const harness = await renderAssetHarness(state, { remote, saveCanvas: vi.fn(async () => ({ id: 'tpl-1' })) })

    await act(async () => { await harness.editor.promoteEditor() })

    expect(harness.toasts).toEqual([{ kind: 'info', text: zh.assetPromoteUnchanged }])
  })

  it('ERR_ASSET_DUPLICATE：按重复入库语义提示且不刷新列表、不报错', async () => {
    const { remote, calls } = makeRemote(() => { throw remoteError('duplicate', EP.ERR_ASSET_DUPLICATE) })
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 'tpl-1',
      editor: { source: 'flowTemplate', id: 'tpl-1' },
    }
    const harness = await renderAssetHarness(state, { remote, saveCanvas: vi.fn(async () => ({ id: 'tpl-1' })) })

    await act(async () => { await harness.editor.promoteEditor() })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PROMOTE_ASSET])
    expect(harness.toasts).toEqual([{ kind: 'info', text: zh.assetDuplicateCancelled }])
    expect(harness.errors).toEqual([])
  })

  it('已入库且模版未再修改：promoteEditor 旁路兜底不入库（按钮禁用之外的第二道防线）', async () => {
    const { remote, calls } = makeRemote(() => ({ workflows: [], roles: [] }))
    const saveCanvas = vi.fn(async () => ({ id: 'tpl-1' }))
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowTemplate',
      currentId: 'tpl-1',
      editor: { source: 'flowTemplate', id: 'tpl-1' },
      assets: {
        workflows: [{ assetId: 'a-1', versionId: 1, name: '资产', description: '', sourceTemplateId: 'tpl-1', sourceFingerprint: 'fp', currentTemplateFingerprint: 'fp', updatedAt: 1 }],
        roles: [],
        retiredWorkflows: [],
        retiredRoles: [],
      },
    }
    const harness = await renderAssetHarness(state, { remote, saveCanvas })

    expect(harness.editor.promoteLocked).toBe(true)
    await act(async () => { await harness.editor.promoteEditor() })

    expect(saveCanvas).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})

describe('资产态保存（登记新版本）', () => {
  it('flowAsset：saveAssetVersion(kind=workflow) 内容取画布与 assetDoc，成功后重装载并重投影画布', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: false }
      if (endpoint === EP.EP_GET_ASSET) return { ...WORKFLOW_DETAIL, versionId: 3, rowId: 'a-1@3' }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    let result: unknown = null
    await act(async () => { result = await harness.editor.saveEditor() })

    expect(calls.map((call) => call.endpoint)).toEqual([
      // 保存前先做只读影响面预览：无牵连才直接落库
      EP.EP_PREVIEW_ASSET_CASCADE,
      EP.EP_SAVE_ASSET_VERSION,
      EP.EP_LIST_ASSETS,
      EP.EP_GET_ASSET,
    ])
    expect(calls[1]!.args).toEqual({
      kind: 'workflow',
      assetId: 'a-1',
      payload: {
        mode: 'mode1',
        name: '资产一',
        description: '资产描述',
        nodes: [{ id: 'n-new', kind: 'agent', position: { x: 10, y: 20 }, data: { label: '新' } }],
        lines: [],
      },
    })
    expect(harness.toasts).toEqual([{ kind: 'success', text: zh.toastAssetVersionSaved.replace('{id}', 'a-1').replace('{version}', '3') }])
    // 非 null = 本次已真实落库（未保存守卫据此接续）；重投影画布 = OPEN_FLOW_ASSET（清除 dirty）
    expect(result).not.toBeNull()
    expect(harness.dispatched.map((action) => action.type)).toContain('ASSET_DOC_LOADED')
    expect(harness.dispatched.at(-1)).toEqual({ type: 'OPEN_FLOW_ASSET', assetId: 'a-1' })
  })

  it('flowAsset：详情重装载失败 → 不重投影画布（未落库的画布编辑不丢）', async () => {
    const { remote } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: false }
      if (endpoint === EP.EP_GET_ASSET) throw remoteError('gone', EP.ERR_ASSET_NOT_FOUND)
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    await act(async () => { await harness.editor.saveEditor() })

    expect(harness.dispatched.some((action) => action.type === 'OPEN_FLOW_ASSET')).toBe(false)
  })

  it('flowAsset：无未保存改动（dirty=false）→ 不做影响面预览，直接保存（后端判未变化）', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-1', versionId: 2, rowId: 'a-1@2', unchanged: true }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState({ dirty: false }), { remote })

    await act(async () => { await harness.editor.saveEditor() })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_SAVE_ASSET_VERSION, EP.EP_LIST_ASSETS, EP.EP_GET_ASSET])
    // 无改动保存仍走「重装载 + 重投影」以对齐实例态语义，但绝不弹确认框
    expect(harness.dispatched.map((action) => action.type)).toEqual(['ASSETS_LOADED', 'ASSET_DOC_LOADED', 'OPEN_FLOW_ASSET'])
  })

  it('flowAsset：预览有牵连 → 先弹二次确认（本次不落库），确认后才登记新版本', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_PREVIEW_ASSET_CASCADE) {
        return { kind: 'workflow', affected: [{ assetId: 'a-other', name: '别的流程', versionCount: 1 }] }
      }
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: false }
      if (endpoint === EP.EP_GET_ASSET) return { ...WORKFLOW_DETAIL, versionId: 3, rowId: 'a-1@3' }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    let result: unknown = 'sentinel'
    await act(async () => { result = await harness.editor.saveEditor() })

    // 待确认：本次调用不落库（返回 null，未保存守卫据此不接续原操作）
    expect(result).toBeNull()
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PREVIEW_ASSET_CASCADE])
    const confirm = lastConfirm(harness.dispatched) as { title?: string; message?: string; onConfirm?: () => void } | undefined
    expect(confirm?.title).toBe(zh.assetCascadeTitle)
    expect(confirm?.message).toBe(zh.assetCascadeWorkflowMessage.replace('{names}', '别的流程'))

    await act(async () => {
      confirm!.onConfirm?.()
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })

    expect(calls.map((call) => call.endpoint)).toEqual([
      EP.EP_PREVIEW_ASSET_CASCADE,
      EP.EP_SAVE_ASSET_VERSION,
      EP.EP_LIST_ASSETS,
      EP.EP_GET_ASSET,
    ])
  })

  it('roleAsset：预览有牵连 → 确认文案列出引用了该角色资产的工作流资产', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_PREVIEW_ASSET_CASCADE) {
        return { kind: 'role', affected: [{ assetId: 'a-2', name: '资产二', versionCount: 2 }] }
      }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(roleAssetState(), { remote })

    await act(async () => { await harness.editor.saveEditor() })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PREVIEW_ASSET_CASCADE])
    const confirm = lastConfirm(harness.dispatched) as { message?: string } | undefined
    expect(confirm?.message).toBe(zh.assetCascadeRoleMessage.replace('{names}', '资产二'))
  })

  it('roleAsset：saveAssetVersion(kind=role) 上报角色字段投影，成功后重装载详情', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-r1', versionId: 2, rowId: 'a-r1@2', unchanged: false, roleAssetType: 'shared' }
      if (endpoint === EP.EP_GET_ASSET) return { ...ROLE_DETAIL, versionId: 2, rowId: 'a-r1@2' }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(roleAssetState(), { remote })

    let result: unknown = null
    await act(async () => { result = await harness.editor.saveEditor() })

    expect(calls.map((call) => call.endpoint)).toEqual([
      EP.EP_PREVIEW_ASSET_CASCADE,
      EP.EP_SAVE_ASSET_VERSION,
      EP.EP_LIST_ASSETS,
      EP.EP_GET_ASSET,
    ])
    expect(calls[1]!.args).toEqual({
      kind: 'role',
      assetId: 'a-r1',
      payload: {
        kind: 'agent',
        name: '资产角色',
        systemPrompt: '提示词',
        provider: 'deepseek',
        model: 'deepseek-chat',
        reasoning: 'high',
        presetId: 'standard',
        retryLimit: 5,
        reactLimit: 7,
        inputSchema: 'in',
        outputSchema: 'out',
        systemPromptSource: 'a.md',
        injectSystemPrompt: false,
        injectToolSections: true,
        promptFilePath: 'D:\\p.md',
      },
    })
    expect(result).not.toBeNull()
    expect(harness.toasts).toEqual([{ kind: 'success', text: zh.toastAssetVersionSaved.replace('{id}', 'a-r1').replace('{version}', '2') }])
    // 角色资产不在画布上：重装载 Active 详情（新版本号/行 id 与属性栏同源），不重投影画布
    expect(harness.dispatched.map((action) => action.type)).toEqual(['ASSETS_LOADED', 'ROLE_ASSET_LOADED'])
  })

  it('资产态保存失败：不重装载、不提示成功、返回值 null', async () => {
    const failure = new Error('boom')
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_PREVIEW_ASSET_CASCADE) return { kind: 'workflow', affected: [] }
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) throw failure
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    let result: unknown = 'sentinel'
    await act(async () => { result = await harness.editor.saveEditor() })

    expect(result).toBeNull()
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PREVIEW_ASSET_CASCADE, EP.EP_SAVE_ASSET_VERSION])
    expect(harness.errors).toEqual([failure])
    // 失败路径不重装载、不重投影画布、不提示成功
    expect(harness.dispatched).toEqual([])
    expect(harness.toasts).toEqual([])
  })

  it('影响面预览失败：显式提示并按「无影响面」降级，不阻断保存', async () => {
    const previewFailure = new Error('preview unavailable')
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_PREVIEW_ASSET_CASCADE) throw previewFailure
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: false }
      if (endpoint === EP.EP_GET_ASSET) return { ...WORKFLOW_DETAIL, versionId: 3, rowId: 'a-1@3' }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    let result: unknown = null
    await act(async () => { result = await harness.editor.saveEditor() })

    // 预览只是告知辅助：失败必须提示（否则用户会把「没弹确认」误读成「没有级联影响」），但保存照常
    expect(harness.errors).toEqual([previewFailure])
    expect(result).not.toBeNull()
    expect(calls.map((call) => call.endpoint)).toEqual([
      EP.EP_PREVIEW_ASSET_CASCADE,
      EP.EP_SAVE_ASSET_VERSION,
      EP.EP_LIST_ASSETS,
      EP.EP_GET_ASSET,
    ])
  })

  it('未保存守卫「保存并继续」：资产态保存真实落库后接续原操作', async () => {
    const { remote, calls } = assetWriteRemote({ endpoint: EP.EP_SAVE_ASSET_VERSION, value: { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: false } })
    let proceeded = false
    const harness = await renderAssetHarness(flowAssetState({
      confirm: { kind: 'unsaved', proceed: () => { proceeded = true } },
    }), { remote })

    await act(async () => {
      await harness.guard.saveAndProceed((onSaved) => harness.editor.saveEditor({ onSaved }))
    })

    expect(calls[0]!.endpoint).toBe(EP.EP_PREVIEW_ASSET_CASCADE)
    expect(calls[1]!.endpoint).toBe(EP.EP_SAVE_ASSET_VERSION)
    expect(proceeded).toBe(true)
  })

  it('未保存守卫「保存并继续」：资产态保存失败不继续（未保存内容不丢）', async () => {
    const { remote } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) throw remoteError('gone', EP.ERR_ASSET_NOT_FOUND)
      return { workflows: [], roles: [] }
    })
    let proceeded = false
    const harness = await renderAssetHarness(flowAssetState({
      confirm: { kind: 'unsaved', proceed: () => { proceeded = true } },
    }), { remote })

    await act(async () => {
      await harness.guard.saveAndProceed((onSaved) => harness.editor.saveEditor({ onSaved }))
    })

    expect(proceeded).toBe(false)
  })
})

describe('资产版本回滚', () => {
  it('openAssetVersions：按当前资产 kind/assetId 装载版本列表', async () => {
    const items = [{ versionId: 2, rowId: 'a-1@2', name: 'v2', createdAt: 2, source: 'human', active: true }]
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_LIST_ASSET_VERSIONS ? items : { workflows: [], roles: [] }))
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    await act(async () => { await harness.editor.openAssetVersions() })

    expect(calls[0]).toEqual({ endpoint: EP.EP_LIST_ASSET_VERSIONS, args: { kind: 'workflow', assetId: 'a-1' } })
    expect(harness.dispatched).toEqual([{ type: 'ASSET_VERSIONS_LOADED', kind: 'workflow', assetId: 'a-1', items }])
  })

  it('rollbackAssetVersion：回滚 Active 指针后收起版本列表（不新增版本）', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_ROLLBACK_ASSET) return WORKFLOW_DETAIL
      if (endpoint === EP.EP_GET_ASSET) return WORKFLOW_DETAIL
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    await act(async () => { await harness.editor.rollbackAssetVersion(1) })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_ROLLBACK_ASSET, EP.EP_GET_ASSET, EP.EP_LIST_ASSETS])
    expect(calls[0]!.args).toEqual({ kind: 'workflow', assetId: 'a-1', versionId: 1 })
    expect(harness.dispatched.at(-1)).toEqual({ type: 'ASSET_VERSIONS_CLOSED' })
  })

  it('rollbackAssetVersion：回滚失败不收起版本列表（保留现场，可直接改选另一版本重试）', async () => {
    const { remote } = makeRemote(() => { throw remoteError('not found', EP.ERR_ASSET_NOT_FOUND) })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    await act(async () => { await harness.editor.rollbackAssetVersion(1) })

    expect(harness.dispatched.some((action) => action.type === 'ASSET_VERSIONS_CLOSED')).toBe(false)
  })

  it('openAssetVersions：画布角色节点按 sourceAssetId 装载版本列表', async () => {
    const items = [{ versionId: 1, rowId: 'a-r1@1', name: 'v1', createdAt: 1, source: 'human', active: false }]
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_LIST_ASSET_VERSIONS ? items : { workflows: [], roles: [] }))
    const harness = await renderAssetHarness(roleNodeState(), { remote })

    await act(async () => { await harness.editor.openAssetVersions() })

    expect(calls[0]).toEqual({ endpoint: EP.EP_LIST_ASSET_VERSIONS, args: { kind: 'role', assetId: 'a-r1' } })
  })

  it('rollbackAssetVersion：画布角色节点回滚后刷新节点角色字段，且不动归属与绑定', async () => {
    const rolledDetail = { ...ROLE_DETAIL, name: '回滚名', systemPrompt: '回滚提示词' }
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_ROLLBACK_ASSET) return rolledDetail
      if (endpoint === EP.EP_GET_ASSET) return rolledDetail
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(roleNodeState(), { remote })

    await act(async () => { await harness.editor.rollbackAssetVersion(1) })

    expect(calls[0]).toEqual({ endpoint: EP.EP_ROLLBACK_ASSET, args: { kind: 'role', assetId: 'a-r1', versionId: 1 } })
    const patchAction = harness.dispatched.find((action) => action.type === 'NODE_DATA_PATCH') as
      | { type: 'NODE_DATA_PATCH'; id: string; patch: Record<string, unknown> }
      | undefined
    expect(patchAction?.id).toBe('n-role')
    expect(patchAction?.patch).toMatchObject({ label: '回滚名', systemPrompt: '回滚提示词' })
    // 归属（groupId）与绑定（sourceAssetId）属于画布，不属于资产内容：不在刷新字段集内
    expect(patchAction?.patch.groupId).toBeUndefined()
    expect(patchAction?.patch.sourceAssetId).toBeUndefined()
    // 回滚成功才收起版本列表
    expect(harness.dispatched).toContainEqual({ type: 'ASSET_VERSIONS_CLOSED' })
  })

  it('rollbackAssetVersion：未绑定来源资产的画布节点没有可回滚对象（不发起任何调用）', async () => {
    const { remote, calls } = makeRemote(() => ({ workflows: [], roles: [] }))
    const harness = await renderAssetHarness(roleNodeState({ bound: false }), { remote })

    await act(async () => { await harness.editor.rollbackAssetVersion(1) })

    expect(calls).toEqual([])
    expect(harness.dispatched).toEqual([])
  })
})

describe('资产退役（二次确认 + 级联提示）', () => {
  it('工作流资产：二次确认后 retireAsset + 清空已打开资产', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_RETIRE_ASSET) return { kind: 'workflow', assetId: 'a-1', retired: true }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(flowAssetState(), { remote })

    await act(async () => { await harness.editor.deleteEditor() })
    const confirm = lastConfirm(harness.dispatched) as { title?: string; message?: string; onConfirm?: () => void } | undefined
    expect(confirm?.title).toBe(zh.assetRetireTitle)
    expect(confirm?.message).toBe(zh.assetRetireMessage)

    await act(async () => {
      confirm!.onConfirm?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_RETIRE_ASSET, EP.EP_LIST_ASSETS])
    expect(calls[0]!.args).toEqual({ kind: 'workflow', assetId: 'a-1' })
    expect(harness.dispatched).toContainEqual({ type: 'ASSET_CLOSED', assetId: 'a-1' })
  })

  it('shared 角色资产：确认文案追加影响面（引用数与资产名清单）', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_RETIRE_ASSET) return { kind: 'role', assetId: 'a-r1', retired: true }
      return { workflows: [], roles: [] }
    })
    const harness = await renderAssetHarness(roleAssetState(), { remote })

    await act(async () => { await harness.editor.deleteEditor() })
    const confirm = lastConfirm(harness.dispatched) as { message?: string; onConfirm?: () => void } | undefined

    expect(confirm?.message).toBe(sharedRetireMessageOf('2', '资产一、资产二'))
    expect(confirm?.message).not.toContain('{count}')
    expect(confirm?.message).not.toContain('{names}')

    await act(async () => {
      confirm!.onConfirm?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(calls[0]).toEqual({ endpoint: EP.EP_RETIRE_ASSET, args: { kind: 'role', assetId: 'a-r1' } })
    expect(harness.dispatched).toContainEqual({ type: 'ASSET_CLOSED', assetId: 'a-r1' })
  })

  it('无引用的角色资产：使用普通归档确认文案', async () => {
    const harness = await renderAssetHarness(roleAssetState({
      assetRoleDoc: {
        ...ROLE_DETAIL,
        roleAssetType: 'standalone',
        referenceWorkflowIds: [],
        referencingWorkflowAssets: [],
      } as never,
    }), { remote: makeRemote(() => ({ workflows: [], roles: [] })).remote })

    await act(async () => { await harness.editor.deleteEditor() })

    const confirm = lastConfirm(harness.dispatched) as { message?: string } | undefined
    expect(confirm?.message).toBe(zh.assetRetireMessage)
  })

  it('已归档资产：归档动作直接返回（按钮已置灰，此处是第二道防线）', async () => {
    const { remote, calls } = makeRemote(() => ({ workflows: [], roles: [] }))
    const harness = await renderAssetHarness(flowAssetState({
      assetDoc: { ...WORKFLOW_DETAIL, retired: true } as never,
    }), { remote })

    await act(async () => { await harness.editor.deleteEditor() })

    expect(calls).toEqual([])
    expect(harness.dispatched).toEqual([])
  })
})

describe('资产态属性栏 patch', () => {
  it('roleAsset：字段写回 assetRoleDoc（label 消毒为 name）', async () => {
    const { face, dispatched } = await renderFace(roleAssetState())

    act(() => { face.patchEditor({ label: '新名字', systemPrompt: '改后的提示词' }) })

    expect(dispatched).toEqual([{ type: 'ROLE_ASSET_PATCH', patch: { name: '新名字', systemPrompt: '改后的提示词' } }])
  })

  it('flowAsset：名/描述走 DOC_PATCH（与实例/模版同路径）', async () => {
    const { face, dispatched } = await renderFace(flowAssetState())

    act(() => { face.patchEditor({ name: '新名字' }) })

    expect(dispatched).toEqual([{ type: 'DOC_PATCH', patch: { name: '新名字', description: undefined } }])
  })
})

describe('资产态保存与状态机联动（真实 reducer）', () => {
  /** 真实状态机 + 资产面 + 编辑器面（验证 dispatch 落到 reducer 后的最终状态）。 */
  async function renderReducerHarness(initial: StudioState, remote: RemoteFace): Promise<{
    editor: EditorActionsFace
    state: StudioState
  }> {
    let editor: EditorActionsFace | null = null
    let live: StudioState = initial
    const noop = (): void => {}
    function Probe(): null {
      const [state, dispatch] = React.useReducer(studioReducer, initial)
      live = state
      const assets = useAssets(remote, dispatch as never, noop as never, noop as never, zh, state)
      const e = useEditorActions(
        state, dispatch as never, noop as never, noop as never, zh,
        {} as never, {} as never, {} as never, assets, {} as never, remote,
        (async () => null) as never,
        noop, noop, noop, noop,
        unlocked,
      )
      useEffect(() => { editor = e }, [e])
      return null
    }
    await act(async () => {
      if (root) { root.unmount(); root = null }
      root = createRoot(container!)
      root.render(React.createElement(Probe))
    })
    return {
      get editor() { return editor! },
      get state() { return live },
    }
  }

  it('flowAsset 保存成功后：dirty 清除、画布重投影为服务端最新详情（对齐实例态保存语义）', async () => {
    const { remote } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) return { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: false }
      if (endpoint === EP.EP_GET_ASSET) {
        return {
          ...WORKFLOW_DETAIL,
          versionId: 3,
          rowId: 'a-1@3',
          nodes: [{ id: 'n-server', kind: 'agent', position: { x: 1, y: 2 }, data: { label: '服务端' } }],
        }
      }
      return { workflows: [], roles: [] }
    })
    const harness = await renderReducerHarness(flowAssetState(), remote)
    expect(harness.state.dirty).toBe(true)
    expect(harness.state.canvas.nodes.map((node) => node.id)).toEqual(['n-new'])

    await act(async () => { await harness.editor.saveEditor() })

    expect(harness.state.dirty).toBe(false)
    expect(harness.state.assetDoc?.versionId).toBe(3)
    expect(harness.state.canvas.nodes.map((node) => node.id)).toEqual(['n-server'])
    expect(harness.state.savedGraph?.nodes.map((node) => node.id)).toEqual(['n-server'])
  })
})
