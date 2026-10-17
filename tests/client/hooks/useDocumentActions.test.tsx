// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useDocumentActions.test.tsx
//
// createInstanceFromCanvas 直测（D08-16）。此前该函数在 tests/client 内符号级零命中，
// 只有 Studio 装配层间接覆盖三分支；本文件在 hook 级锁定：
//   - 即时创建：模板画布 → 新实例并落库，接续 afterCreate；
//   - 覆盖确认：目标会话已有同模式实例 → 二次确认，确认后复用旧实例 id/createdAt；
//   - 新建会话：模板级持久化配置（startNewSession/workspacePath）→ createSession 后
//     实例绑定新会话；资产态为一次性临时选项（无路径来源）；
//   - 边界：createSession 返回 200 空体 / 调用失败、模式二运行中服务实例拒绝覆盖、
//     运行中实例保存的二次确认、实例态等价保存、非实例来源早退、保存失败的分支提示。
// 断言行为（dispatched / toast / 落库入参 / 回调），不断言内部实现细节。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { EP } from '../../../src/client/lib/remote.js'
import { zh } from '../../../src/client/i18n.js'
import { createInitialState, type ConfirmState, type StudioAction, type StudioState } from '../../../src/client/studio/studio-state.js'
import { useDocumentActions, type DocumentActionsFace } from '../../../src/client/hooks/useDocumentActions.js'
import type { WorkflowsFace } from '../../../src/client/hooks/useWorkflows.js'
import type { FlowTemplatesFace } from '../../../src/client/hooks/useFlowTemplates.js'
import type { TemplatesFace } from '../../../src/client/hooks/useTemplates.js'
import type { SelectionFace } from '../../../src/client/hooks/useSelection.js'
import type { UnsavedGuardFace } from '../../../src/client/hooks/useUnsavedGuard.js'
import type { ServiceControlFace } from '../../../src/client/hooks/useServiceControl.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { WorkflowDocument, WorkflowTemplate, GraphNode } from '../../../src/host/shared/graph-model.js'
import type { ServiceState } from '../../../src/host/shared/types.js'
import { waitForCondition } from '../fixtures/async-flush.js'

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
})

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 合法角色节点（文档里的节点必须满足 GraphNode 形状，不能只给 label）。 */
function roleNode(id: string, label: string): GraphNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

const TEMPLATE: WorkflowTemplate = {
  id: 'T-1',
  mode: 'mode1',
  name: '模板一',
  description: '模板描述',
  nodes: [roleNode('t-n1', '模板节点')],
  lines: [],
  meta: { nodeMax: 5 },
}

/** 模板态：当前画布 = 模板，画布内容即实例化事实源。 */
function templateState(partial: Partial<StudioState> = {}): StudioState {
  return {
    ...createInitialState('s-1'),
    currentKind: 'flowTemplate',
    currentId: TEMPLATE.id,
    flowTemplates: [TEMPLATE],
    canvas: { nodes: [{ id: 'c-n1', kind: 'agent', position: { x: 10, y: 20 }, data: { label: '画布节点' } }], edges: [] },
    ...partial,
  }
}

/** 实例态：当前画布 = 已存在的工作流实例。 */
function instanceState(partial: Partial<StudioState> = {}): StudioState {
  const flow: WorkflowDocument = {
    id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '实例一', description: '', revision: 3, nodes: [], lines: [],
  }
  return {
    ...createInitialState('s-1'),
    currentKind: 'workflow',
    currentId: flow.id,
    workflows: [flow],
    ...partial,
  }
}

interface RenderOverrides {
  /** EP_CREATE_SESSION 的行为（缺省返回新会话 id）。 */
  createSession?: () => Promise<unknown>
  /** saveWorkflow 的行为（缺省成功返回 revision+1）。 */
  saveWorkflow?: (flow: WorkflowDocument) => Promise<WorkflowDocument | null>
}

interface DocHarness {
  face: DocumentActionsFace
  dispatched: StudioAction[]
  toasts: Array<{ kind: 'info' | 'success' | 'error'; text: string }>
  errors: unknown[]
  saveWorkflow: ReturnType<typeof vi.fn<(flow: WorkflowDocument, nodes: unknown[], edges: unknown[]) => Promise<WorkflowDocument | null>>>
  saveService: ReturnType<typeof vi.fn<(service: ServiceState) => Promise<ServiceState | null>>>
  instantiateFromTemplate: ReturnType<typeof vi.fn<(template: WorkflowTemplate, sessionId: string, fallbackName: string) => WorkflowDocument>>
  serviceInstantiate: ReturnType<typeof vi.fn<(template: WorkflowTemplate, sessionId: string, fallbackName: string) => ServiceState>>
  openFlow: ReturnType<typeof vi.fn<(flow: WorkflowDocument) => void>>
  remoteCall: ReturnType<typeof vi.fn<(endpoint: string, args?: Record<string, unknown>) => Promise<unknown>>>
  loadWorkflows: ReturnType<typeof vi.fn<() => Promise<WorkflowDocument[]>>>
  /** 模板保存（模板级新会话配置变更即保存）。 */
  saveFlowTemplate: ReturnType<typeof vi.fn<(template: WorkflowTemplate) => Promise<WorkflowTemplate>>>
  loadFlowTemplates: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  /** 最近一次 CONFIRM_SET 的确认框状态（未派发则为 null）。 */
  lastConfirm(): ConfirmState | null
}

async function renderDoc(state: StudioState, overrides: RenderOverrides = {}): Promise<DocHarness> {
  const dispatched: StudioAction[] = []
  const toasts: DocHarness['toasts'] = []
  const errors: unknown[] = []
  const dispatch = ((action: StudioAction) => { dispatched.push(action) }) as never
  const notify = (kind: 'info' | 'success' | 'error', text: string): void => { toasts.push({ kind, text }) }
  const toastError = (error: unknown): void => { errors.push(error) }

  const saveWorkflow = vi.fn(async (flow: WorkflowDocument) => (
    overrides.saveWorkflow
      ? await overrides.saveWorkflow(flow)
      : { ...flow, revision: Number(flow.revision ?? 0) + 1 }
  ))
  const loadWorkflows = vi.fn(async () => [] as WorkflowDocument[])
  const instantiateFromTemplate = vi.fn((template: WorkflowTemplate, sessionId: string, fallbackName: string): WorkflowDocument => ({
    id: 'wf-new',
    sessionId,
    mode: template.mode,
    name: template.name || fallbackName,
    description: template.description ?? '',
    revision: 0,
    nodes: template.nodes ?? [],
    lines: template.lines ?? [],
  }))
  const openFlow = vi.fn<(flow: WorkflowDocument) => void>()
  const saveService = vi.fn(async (service: ServiceState) => ({ ...service, revision: Number(service.revision ?? 0) + 1 }))
  const serviceInstantiate = vi.fn((template: WorkflowTemplate, sessionId: string, fallbackName: string): ServiceState => ({
    id: 'sv-new',
    sessionId,
    name: template.name || fallbackName,
    description: template.description ?? '',
    revision: 0,
    nodes: template.nodes ?? [],
    lines: template.lines ?? [],
    createdAt: '',
    updatedAt: '',
    status: 'stopped',
  }))
  const remoteCall = vi.fn(async (_endpoint: string, _args?: Record<string, unknown>) => (
    overrides.createSession ? await overrides.createSession() : { sessionId: 's-new' }
  ))
  const saveFlowTemplate = vi.fn(async (template: WorkflowTemplate): Promise<WorkflowTemplate> => (
    { ...template, revision: Number(template.revision ?? 0) + 1 }
  ))
  const loadFlowTemplates = vi.fn(async () => undefined)
  const flowTemplates = {
    saveFlowTemplate,
    loadFlowTemplates,
  } as unknown as FlowTemplatesFace

  const workflows = {
    loadWorkflows,
    createWorkflowDraft: vi.fn(() => { throw new Error('本文件不覆盖草稿路径') }),
    saveWorkflow,
    instantiateFromTemplate,
    deleteWorkflow: vi.fn(async () => {}),
    openFlow,
  } as unknown as WorkflowsFace
  const serviceControl = {
    loadServices: vi.fn(async () => [] as ServiceState[]),
    instantiateFromTemplate: serviceInstantiate,
    saveService,
  } as unknown as ServiceControlFace
  const guard = {
    confirm: null,
    guard: vi.fn(),
    saveAndProceed: vi.fn(async () => {}),
    discardAndProceed: vi.fn(),
    cancel: vi.fn(),
  } as unknown as UnsavedGuardFace

  let face: DocumentActionsFace | null = null
  function Harness(): null {
    const f = useDocumentActions(
      state,
      dispatch,
      guard,
      notify,
      toastError,
      workflows,
      flowTemplates,
      {} as TemplatesFace,
      {} as SelectionFace,
      serviceControl,
      { call: remoteCall } as unknown as RemoteFace,
      zh,
    )
    useEffect(() => { face = f }, [f])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })

  return {
    face: face!,
    dispatched,
    toasts,
    errors,
    saveWorkflow,
    saveService,
    instantiateFromTemplate,
    serviceInstantiate,
    openFlow,
    remoteCall,
    loadWorkflows,
    saveFlowTemplate,
    loadFlowTemplates,
    lastConfirm: () => {
      const last = [...dispatched].reverse().find((action) => action.type === 'CONFIRM_SET')
      return last ? (last as Extract<StudioAction, { type: 'CONFIRM_SET' }>).confirm : null
    },
  }
}

// ---------------------------------------------------------------------------
// 即时创建
// ---------------------------------------------------------------------------

describe('createInstanceFromCanvas：即时创建（目标会话无同模式实例）', () => {
  it('模板画布 → 保存为新实例、切到实例态、toast 与 afterCreate 接续；返回值恒为 null', async () => {
    const state = templateState()
    const h = await renderDoc(state)
    const afterCreate = vi.fn()

    let returned: WorkflowDocument | null = null
    await act(async () => { returned = await h.face.createInstanceFromCanvas(afterCreate) })

    // 契约：结果经 afterCreate 接续，调用方不得依赖返回值判断成功
    expect(returned).toBeNull()
    expect(h.instantiateFromTemplate).toHaveBeenCalledWith(TEMPLATE, 's-1', zh.untitledWorkflow)
    expect(h.saveWorkflow).toHaveBeenCalledTimes(1)
    const [draft, nodes, edges] = h.saveWorkflow.mock.calls[0]
    expect(draft.sessionId).toBe('s-1')
    // 节点与连线一律取当前画布（编辑中的草稿即事实源）
    expect(nodes).toBe(state.canvas.nodes)
    expect(edges).toBe(state.canvas.edges)
    expect(h.dispatched.map((action) => action.type)).toContain('MARK_SAVED')
    expect(h.openFlow).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-new' }))
    expect(h.toasts).toEqual([{ kind: 'success', text: zh.toastCreatedInstance }])
    expect(afterCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-new' }))
    // 无既有实例 → 不弹确认框
    expect(h.lastConfirm()).toBeNull()
  })

  it('保存失败（乐观锁冲突）→ 刷新列表并提示重试，不接续 afterCreate、不切文档', async () => {
    const conflict = Object.assign(new Error('revision conflict'), { code: EP.ERR_REVISION_CONFLICT })
    const h = await renderDoc(templateState(), { saveWorkflow: async () => { throw conflict } })
    const afterCreate = vi.fn()

    await act(async () => { await h.face.createInstanceFromCanvas(afterCreate) })

    expect(h.loadWorkflows).toHaveBeenCalledTimes(1)
    expect(h.toasts).toEqual([{ kind: 'error', text: zh.revisionConflictRetry }])
    expect(h.openFlow).not.toHaveBeenCalled()
    expect(afterCreate).not.toHaveBeenCalled()
  })

  it('保存失败（非冲突）→ 走通用错误提示，不接续 afterCreate', async () => {
    const failure = new Error('落库失败')
    const h = await renderDoc(templateState(), { saveWorkflow: async () => { throw failure } })
    const afterCreate = vi.fn()

    await act(async () => { await h.face.createInstanceFromCanvas(afterCreate) })

    expect(h.errors).toEqual([failure])
    expect(afterCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 覆盖确认
// ---------------------------------------------------------------------------

describe('createInstanceFromCanvas：覆盖确认（目标会话已有同模式实例）', () => {
  const EXISTING: WorkflowDocument = {
    id: 'wf-old', sessionId: 's-1', mode: 'mode1', name: '旧实例', description: '旧描述',
    revision: 7, nodes: [roleNode('old-n1', '旧节点')], lines: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  it('先弹二次确认且本次不落库；确认后复用旧实例 id/createdAt、名称取模板最新定义', async () => {
    const h = await renderDoc(templateState({ workflows: [EXISTING] }))
    const afterCreate = vi.fn()

    await act(async () => { await h.face.createInstanceFromCanvas(afterCreate) })

    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.instantiateFromTemplate).not.toHaveBeenCalled()
    const confirm = h.lastConfirm()
    expect(confirm).toMatchObject({
      kind: 'confirmText',
      title: zh.overwriteInstanceTitle,
      message: zh.overwriteInstanceMessage,
      confirmLabel: zh.overwriteInstanceConfirm,
    })
    expect(confirm?.onConfirm).toBeTypeOf('function')
    expect(afterCreate).not.toHaveBeenCalled()

    await act(async () => { confirm!.onConfirm!() })
    await waitForCondition(() => expect(h.saveWorkflow).toHaveBeenCalledTimes(1))

    const [draft] = h.saveWorkflow.mock.calls[0]
    // 覆盖：复用旧实例 id/sessionId/createdAt 与 revision（保存层 +1），内容取模板
    expect(draft).toMatchObject({ id: 'wf-old', sessionId: 's-1', name: TEMPLATE.name, createdAt: EXISTING.createdAt, revision: 7 })
    expect(draft.nodes).toEqual(TEMPLATE.nodes)
    expect(draft.nodes).not.toBe(TEMPLATE.nodes)
    expect(draft.meta).toEqual(TEMPLATE.meta)
    expect(h.openFlow).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-old' }))
    expect(h.toasts).toEqual([{ kind: 'success', text: zh.toastInstanceOverwritten }])
    expect(afterCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-old' }))
  })

  it('取消（不调用 onConfirm）→ 不落库、不提示成功', async () => {
    const h = await renderDoc(templateState({ workflows: [EXISTING] }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.lastConfirm()?.kind).toBe('confirmText')
    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.toasts).toEqual([])
    expect(h.openFlow).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 新建会话（模板态 = 模板级持久化配置；资产态 = 一次性临时选项）
// ---------------------------------------------------------------------------

/** 模板态现场（画布 = 指定模板；新会话配置是模板持久化字段）。 */
function templateWithOptions(patch: Partial<WorkflowTemplate>): StudioState {
  return templateState({ flowTemplates: [{ ...TEMPLATE, ...patch }] })
}

/** 资产态现场（无模板文档：新会话只能是一次性临时选项，无路径来源）。 */
function assetState(partial: Partial<StudioState> = {}): StudioState {
  return {
    ...createInitialState('s-1'),
    currentKind: 'flowAsset',
    currentId: 'a-1',
    assetDoc: {
      assetId: 'a-1', versionId: 1, rowId: 'a-1@1', mode: 'mode1', name: '资产一', description: '',
      nodes: [], lines: [], roleVersionIds: [], createdAt: 1,
    } as unknown as StudioState['assetDoc'],
    ...partial,
  }
}

describe('createInstanceFromCanvas：开启新会话（模板级持久化配置）', () => {
  it('模板勾选 + 工作区 → 先 createSession（携带工作区），再实例绑定新会话', async () => {
    const h = await renderDoc(templateWithOptions({ startNewSession: true, workspacePath: 'D:/ws' }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.remoteCall).toHaveBeenCalledWith(EP.EP_CREATE_SESSION, { sessionId: 's-1', workspacePath: 'D:/ws' })
    expect(h.saveWorkflow).toHaveBeenCalledTimes(1)
    expect(h.saveWorkflow.mock.calls[0][0].sessionId).toBe('s-new')
  })

  it('模板工作区为空/空白 → 请求体不含 workspacePath 键', async () => {
    const h = await renderDoc(templateWithOptions({ startNewSession: true, workspacePath: '   ' }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.remoteCall).toHaveBeenCalledWith(EP.EP_CREATE_SESSION, { sessionId: 's-1' })
    expect(h.saveWorkflow.mock.calls[0][0].sessionId).toBe('s-new')
  })

  it('模板未勾选时，临时的界面记忆（instanceOptions）不参与模板态决定', async () => {
    const h = await renderDoc(templateState({ instanceOptions: { newSession: true } }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.remoteCall).not.toHaveBeenCalledWith(EP.EP_CREATE_SESSION, expect.anything())
    expect(h.saveWorkflow.mock.calls[0][0].sessionId).toBe('s-1')
  })

  it('新会话里已有同模式实例 → 仍走覆盖确认（按目标会话判定）', async () => {
    const otherSession: WorkflowDocument = {
      id: 'wf-other', sessionId: 's-new', mode: 'mode1', name: '新会话实例', description: '',
      revision: 1, nodes: [], lines: [],
    }
    const h = await renderDoc(templateState({
      workflows: [otherSession],
      flowTemplates: [{ ...TEMPLATE, startNewSession: true }],
    }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.lastConfirm()?.kind).toBe('confirmText')
  })

  it('createSession 返回 200 空体（缺 sessionId）→ 提示创建失败且不落库', async () => {
    const h = await renderDoc(
      templateWithOptions({ startNewSession: true }),
      { createSession: async () => ({}) },
    )
    const afterCreate = vi.fn()

    await act(async () => { await h.face.createInstanceFromCanvas(afterCreate) })

    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.instantiateFromTemplate).not.toHaveBeenCalled()
    expect(h.errors).toHaveLength(1)
    expect((h.errors[0] as Error).message).toBe(zh.sessionCreateFailed)
    expect(afterCreate).not.toHaveBeenCalled()
    expect(h.toasts).toEqual([])
  })

  it('createSession 调用失败 → 提示创建失败且不落库', async () => {
    const failure = new Error('连接中断')
    const h = await renderDoc(
      templateWithOptions({ startNewSession: true }),
      { createSession: async () => { throw failure } },
    )

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.errors).toEqual([failure])
  })

  it('资产态勾选（一次性临时选项）→ 先 createSession，但不携带工作区（资产无路径归属）', async () => {
    const h = await renderDoc(assetState({ instanceOptions: { newSession: true } }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.remoteCall).toHaveBeenCalledWith(EP.EP_CREATE_SESSION, { sessionId: 's-1' })
    expect((h.remoteCall.mock.calls[0][1] as Record<string, unknown>)).not.toHaveProperty('workspacePath')
    expect(h.saveWorkflow.mock.calls[0][0].sessionId).toBe('s-new')
  })
})

// ---------------------------------------------------------------------------
// 模板级新会话配置变更：立即保存（复用模板保存通道）
// ---------------------------------------------------------------------------

describe('setFlowTemplateOptions：变更即保存模板', () => {
  it('勾选新会话 → 乐观更新模板并立即保存（携带当前画布与 startNewSession=true）', async () => {
    const state = templateState()
    const h = await renderDoc(state)

    await act(async () => { await h.face.setFlowTemplateOptions({ startNewSession: true }) })

    // 乐观更新（首次 dispatch）
    const firstUpdate = h.dispatched.find((action) => action.type === 'FLOW_TEMPLATE_UPDATED')
    expect(firstUpdate).toMatchObject({ type: 'FLOW_TEMPLATE_UPDATED', template: { id: TEMPLATE.id, startNewSession: true } })
    // 立即保存：模板内容 + 当前画布
    expect(h.saveFlowTemplate).toHaveBeenCalledTimes(1)
    const [savedTemplate, nodes, edges] = h.saveFlowTemplate.mock.calls[0] as unknown as [WorkflowTemplate, unknown[], unknown[]]
    expect(savedTemplate).toMatchObject({ id: TEMPLATE.id, startNewSession: true })
    expect(nodes).toBe(state.canvas.nodes)
    expect(edges).toBe(state.canvas.edges)
    // 保存成功：记录已保存快照 + 提示
    expect(h.dispatched.map((action) => action.type)).toContain('MARK_SAVED')
    expect(h.toasts).toEqual([{ kind: 'success', text: zh.toastSaved }])
  })

  it('选择工作区路径 → 保存模板的 workspacePath（保留原有勾选/名称等字段）', async () => {
    const h = await renderDoc(templateWithOptions({ startNewSession: true }))

    await act(async () => { await h.face.setFlowTemplateOptions({ workspacePath: 'D:\\work\\project' }) })

    const [savedTemplate] = h.saveFlowTemplate.mock.calls[0] as unknown as [WorkflowTemplate]
    expect(savedTemplate).toMatchObject({
      id: TEMPLATE.id,
      name: TEMPLATE.name,
      startNewSession: true,
      workspacePath: 'D:\\work\\project',
    })
  })

  it('取消勾选保留已存路径（startNewSession 字段移除即「未勾选」，再次勾选可恢复配置）', async () => {
    const h = await renderDoc(templateWithOptions({ startNewSession: true, workspacePath: 'D:\\work\\ws' }))

    await act(async () => { await h.face.setFlowTemplateOptions({ startNewSession: false }) })

    const [savedTemplate] = h.saveFlowTemplate.mock.calls[0] as unknown as [WorkflowTemplate]
    expect(savedTemplate.startNewSession).toBeUndefined()
    expect(savedTemplate.workspacePath).toBe('D:\\work\\ws')
  })

  it('空白路径变更 → 从模板中移除该字段（不落空串噪音）', async () => {
    const h = await renderDoc(templateWithOptions({ startNewSession: true, workspacePath: 'D:\\work\\ws' }))

    await act(async () => { await h.face.setFlowTemplateOptions({ workspacePath: '   ' }) })

    const [savedTemplate] = h.saveFlowTemplate.mock.calls[0] as unknown as [WorkflowTemplate]
    expect(savedTemplate.workspacePath).toBeUndefined()
  })

  it('保存失败（非冲突）→ 回滚到保存前的模板并走通用错误提示', async () => {
    const failure = new Error('落库失败')
    const state = templateState()
    const h = await renderDoc(state)
    h.saveFlowTemplate.mockRejectedValueOnce(failure)

    await act(async () => { await h.face.setFlowTemplateOptions({ startNewSession: true }) })

    expect(h.errors).toEqual([failure])
    // 最后一次 FLOW_TEMPLATE_UPDATED 是回滚（回到原模板）
    const updates = h.dispatched.filter((action) => action.type === 'FLOW_TEMPLATE_UPDATED')
    expect(updates.at(-1)).toMatchObject({ template: { id: TEMPLATE.id } })
    expect((updates.at(-1) as Extract<StudioAction, { type: 'FLOW_TEMPLATE_UPDATED' }>).template.startNewSession).toBeUndefined()
    expect(h.dispatched.map((action) => action.type)).not.toContain('MARK_SAVED')
    expect(h.toasts).toEqual([])
  })

  it('保存冲突 → 刷新模板列表并提示重试（不静默继续）', async () => {
    const conflict = Object.assign(new Error('revision conflict'), { code: EP.ERR_REVISION_CONFLICT })
    const h = await renderDoc(templateState())
    h.saveFlowTemplate.mockRejectedValueOnce(conflict)

    await act(async () => { await h.face.setFlowTemplateOptions({ startNewSession: true }) })

    expect(h.loadFlowTemplates).toHaveBeenCalledTimes(1)
    expect(h.toasts).toEqual([{ kind: 'error', text: zh.revisionConflictRetry }])
  })

  it('资产态调用 → 不触碰模板保存（无持久化归属）', async () => {
    const h = await renderDoc(assetState())

    await act(async () => { await h.face.setFlowTemplateOptions({ startNewSession: true }) })

    expect(h.saveFlowTemplate).not.toHaveBeenCalled()
    expect(h.dispatched.filter((action) => action.type === 'FLOW_TEMPLATE_UPDATED')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 运行状态相关边界
// ---------------------------------------------------------------------------

describe('createInstanceFromCanvas：运行状态边界', () => {
  it('模式二目标会话已有运行中服务实例 → 拒绝覆盖并提示（不弹确认框）', async () => {
    const runningService: ServiceState = {
      id: 'sv-run', sessionId: 's-1', name: '运行中服务', description: '',
      revision: 2, nodes: [], lines: [], createdAt: '', updatedAt: '', status: 'running',
    }
    const h = await renderDoc(templateState({
      mode: 'mode2',
      services: [runningService],
      flowTemplates: [{ ...TEMPLATE, mode: 'mode2' }],
    }))

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.toasts).toEqual([{ kind: 'error', text: zh.toastServiceRunningCannotOverwrite }])
    expect(h.saveService).not.toHaveBeenCalled()
    expect(h.serviceInstantiate).not.toHaveBeenCalled()
    expect(h.lastConfirm()).toBeNull()
  })

  it('实例态且运行中（dirty）→ 保存前弹二次确认；确认后才落库', async () => {
    const h = await renderDoc(instanceState({
      dirty: true,
      activeRuns: [{ flowId: 'wf-1', sessionId: 's-1', status: 'running', runId: 'run-1' }],
    }))
    const afterCreate = vi.fn()

    await act(async () => { await h.face.createInstanceFromCanvas(afterCreate) })

    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.lastConfirm()).toMatchObject({ kind: 'confirmText', title: zh.saveRunningTitle })

    await act(async () => { h.lastConfirm()!.onConfirm!() })
    await waitForCondition(() => expect(h.saveWorkflow).toHaveBeenCalledTimes(1))
    expect(h.toasts).toEqual([{ kind: 'success', text: zh.toastSaved }])
  })

  it('实例态（未运行）→ 等价保存并返回保存结果；afterCreate 不参与该路径', async () => {
    const h = await renderDoc(instanceState())
    const afterCreate = vi.fn()

    let returned: WorkflowDocument | null = null
    await act(async () => { returned = await h.face.createInstanceFromCanvas(afterCreate) })

    expect(h.saveWorkflow).toHaveBeenCalledTimes(1)
    expect(returned).toMatchObject({ id: 'wf-1', revision: 4 })
    expect(h.dispatched.map((action) => action.type)).toContain('MARK_SAVED')
    expect(h.toasts).toEqual([{ kind: 'success', text: zh.toastSaved }])
    expect(afterCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 非实例来源早退
// ---------------------------------------------------------------------------

describe('createInstanceFromCanvas：没有可实例化的来源', () => {
  it('空态（无当前文档）→ 不落库、不请求、不提示', async () => {
    const h = await renderDoc(createInitialState('s-1'))

    let returned: WorkflowDocument | null | undefined
    await act(async () => { returned = await h.face.createInstanceFromCanvas() })

    expect(returned).toBeNull()
    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.instantiateFromTemplate).not.toHaveBeenCalled()
    expect(h.remoteCall).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([])
    expect(h.toasts).toEqual([])
  })

  it('资产态但详情未装载 → 早退（不能凭空实例化）', async () => {
    const h = await renderDoc({
      ...createInitialState('s-1'),
      currentKind: 'flowAsset',
      currentId: 'a-1',
      assetDoc: null,
    })

    await act(async () => { await h.face.createInstanceFromCanvas() })

    expect(h.saveWorkflow).not.toHaveBeenCalled()
    expect(h.instantiateFromTemplate).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([])
  })
})
