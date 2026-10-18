// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/hooks/useStudioTransfer.test.tsx
//
// 导入 / 导出 / 命名冲突 / .md 加载 / 任务描述追加文件路径 / 数据库测试连接（D11-01 覆盖缺口）。
// 这条链路是**不可撤销的用户数据操作**：导出取错会话、导入冲突传错模式、路径追加到错误
// 编辑对象，用户看到的是「导出内容不是当前画布」或「导入后原模板消失」。
//
// 装配方式：真实调用 hook（12 个依赖全部按生产接口逐项构造），只把边界（远端、词典、
// 通知面、文件读取）替身化；不使用 `as never` 之类的类型逃逸。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useStudioTransfer, type StudioTransferFace } from '../../../src/client/hooks/useStudioTransfer.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import { EP } from '../../../src/client/lib/remote.js'
import { TEMPLATE_FORMAT } from '../../../src/client/lib/bundle.js'
import { detectLanguage, text, type Dict } from '../../../src/client/i18n.js'
import type { StudioAction, StudioState } from '../../../src/client/studio/studio-state.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { TemplatesFace } from '../../../src/client/hooks/useTemplates.js'
import type { FlowTemplatesFace } from '../../../src/client/hooks/useFlowTemplates.js'
import type { WorkflowsFace } from '../../../src/client/hooks/useWorkflows.js'
import type { EditorActionsFace } from '../../../src/client/hooks/useEditorActions.js'
import type { EditorData } from '../../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  document.body.innerHTML = ''
  container = null
  vi.restoreAllMocks()
})

/** 生产词典（断言提示语义，避免测试内复制文案）。 */
const dict: Dict = text(detectLanguage(undefined)) as Dict

/** 调用记录：端点 + 参数。 */
interface Call { endpoint: string; args: Record<string, unknown> }

interface Harness {
  face: StudioTransferFace
  calls: Call[]
  dispatched: StudioAction[]
  notified: Array<{ kind: string; text: string }>
  errors: unknown[]
  patches: Array<Record<string, unknown>>
  downloads: Array<{ content: string; fileName: string }>
  templatesLoaded: number
  flowTemplatesLoaded: number
  setState: (next: StudioState) => void
}

/**
 * 装配 hook：state 作为 prop 传入探针组件，测试可切换状态触发重渲染
 * （resolveImportConflict 依赖「当前确认框状态」，必须走真实 props 更新而不是共享可变对象）。
 */
async function mountHarness(initial: StudioState, options: {
  editorData?: EditorData | null
  remoteResult?: (endpoint: string, args: Record<string, unknown>) => unknown
  remoteError?: unknown
} = {}): Promise<Harness> {
  const calls: Call[] = []
  const dispatched: StudioAction[] = []
  const notified: Array<{ kind: string; text: string }> = []
  const errors: unknown[] = []
  const patches: Array<Record<string, unknown>> = []
  const downloads: Array<{ content: string; fileName: string }> = []
  const counters = { templates: 0, flowTemplates: 0 }

  // 下载边界替身：只拦「点击下载链接」这一步（记录文件名），不替身 createElement——
  // 逐次挂载时对同一方法叠加 mock 会自我递归。
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ content: '', fileName: this.download })
  })

  const remote: RemoteFace = {
    stream: vi.fn(async () => undefined),
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      const safe = args ?? {}
      calls.push({ endpoint, args: safe })
      if (options.remoteError !== undefined) throw options.remoteError
      return options.remoteResult ? options.remoteResult(endpoint, safe) : {}
    }),
  }
  const templates = {
    list: [], loadTemplates: vi.fn(async () => { counters.templates += 1; return { role: [], task: [], database: [], group: [] } }),
  } as unknown as TemplatesFace
  const flowTemplates = {
    list: [], loadFlowTemplates: vi.fn(async () => { counters.flowTemplates += 1 }),
  } as unknown as FlowTemplatesFace
  const workflows = { list: [] } as unknown as WorkflowsFace
  const patchEditor: EditorActionsFace['patchEditor'] = (patch) => { patches.push(patch as Record<string, unknown>) }
  const personaRef = { current: null } as React.RefObject<HTMLInputElement | null>
  const groupRef = { current: null } as React.RefObject<HTMLInputElement | null>

  // 每次渲染都刷新 face：hook 的回调闭包捕获的是**本次渲染**的 state，
  // 用首次渲染的 face 会在 setState 后读到过期的确认框状态。
  const faceRef: { current: StudioTransferFace | null } = { current: null }
  function Probe(props: { state: StudioState }): null {
    faceRef.current = useStudioTransfer(
      props.state,
      (action: StudioAction) => { dispatched.push(action) },
      (kind: 'info' | 'success' | 'error', copy: string) => { notified.push({ kind, text: copy }) },
      (error: unknown) => { errors.push(error) },
      dict,
      remote,
      templates,
      flowTemplates,
      workflows,
      patchEditor,
      // 默认编辑数据走热路径（导出按 editorData.kind 分支），形状按 EditorData 逐字段给出
      options.editorData === undefined
        ? ({ kind: 'workflow', data: {}, name: '流程A' } satisfies EditorData)
        : options.editorData,
      personaRef,
      groupRef,
    )
    return null
  }

  await act(async () => {
    if (root) { root.unmount(); root = null }
    // 同一用例可能挂载多次（例如先验成功路径再验失败路径）：每次用新容器，
    // 避免对已 createRoot 过的容器重复 createRoot。
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    root.render(React.createElement(Probe, { state: initial }))
  })
  return {
    get face() { return faceRef.current! },
    calls,
    dispatched,
    notified,
    errors,
    patches,
    downloads,
    get templatesLoaded() { return counters.templates },
    get flowTemplatesLoaded() { return counters.flowTemplates },
    setState: (next: StudioState) => {
      act(() => { root!.render(React.createElement(Probe, { state: next })) })
    },
  } as Harness
}

/** 含一个工作流实例的状态（实例绑定会话 s-9，当前主会话 s-1：导出必须用实例绑定会话）。 */
function stateWithFlow(): StudioState {
  const flow = {
    id: 'wf-a', sessionId: 's-9', mode: 'mode1' as const, name: '流程A', description: '',
    revision: 1, nodes: [], lines: [], createdAt: '', updatedAt: '',
  }
  return {
    ...createInitialState('s-1'),
    workflows: [flow],
    currentKind: 'workflow',
    currentId: 'wf-a',
    editor: { source: 'workflow', id: 'wf-a' },
  }
}

function stateWithNode(kind: 'task' | 'database', data: Record<string, unknown>): StudioState {
  const base = createInitialState('s-1')
  return {
    ...base,
    editor: { source: 'node', id: 'n-1' },
    canvas: { nodes: [{ id: 'n-1', kind, position: { x: 0, y: 0 }, data }], edges: [] },
  } as StudioState
}

describe('useStudioTransfer · 导出', () => {
  it('工作流导出：用实例绑定会话调 EP_EXPORT_WORKFLOW，并按文档名下载', async () => {
    const h = await mountHarness(stateWithFlow(), {
      remoteResult: (endpoint) => (endpoint === EP.EP_EXPORT_WORKFLOW ? { json: '{"k":1}' } : {}),
    })
    await act(async () => { await h.face.exportCurrent() })

    expect(h.calls).toEqual([{ endpoint: EP.EP_EXPORT_WORKFLOW, args: { sessionId: 's-9', id: 'wf-a' } }])
    expect(h.downloads.map((d) => d.fileName)).toEqual(['流程A.json'])
    expect(h.notified).toEqual([{ kind: 'success', text: dict.toastExported }])
  })

  it('导出失败：走 toastError，不下载、不误报成功', async () => {
    const failure = new Error('导不出来')
    const h = await mountHarness(stateWithFlow(), { remoteError: failure })
    await act(async () => { await h.face.exportCurrent() })

    expect(h.errors).toEqual([failure])
    expect(h.downloads).toEqual([])
    expect(h.notified).toEqual([])
  })

  it('无可导出内容（空态）：给出明确「无可导出」提示，不静默', async () => {
    const h = await mountHarness(createInitialState('s-1'), { editorData: null })
    await act(async () => { await h.face.exportCurrent() })

    expect(h.calls).toEqual([])
    expect(h.notified).toEqual([{ kind: 'error', text: dict.exportEmpty }])
  })
})

describe('useStudioTransfer · 导入与命名冲突', () => {
  it('工作流模板导入成功：刷新模板列表并提示成功', async () => {
    const h = await mountHarness(createInitialState('s-1'), {
      remoteResult: (endpoint) => (endpoint === EP.EP_IMPORT_WORKFLOW ? { conflict: false } : {}),
    })
    const file = new File(['{"nodes":[]}'], 'wf.json', { type: 'application/json' })
    await act(async () => { await h.face.handleImportFile(file) })

    expect(h.calls.map((c) => c.endpoint)).toEqual([EP.EP_IMPORT_WORKFLOW])
    expect(h.calls[0].args.json).toBe('{"nodes":[]}')
    expect(h.flowTemplatesLoaded).toBe(1)
    expect(h.notified).toEqual([{ kind: 'success', text: dict.toastImported }])
  })

  it('工作流模板重名：进入冲突确认框（携带 json 与既有名），本次不落库', async () => {
    const h = await mountHarness(createInitialState('s-1'), {
      remoteResult: () => ({ conflict: true, existingName: '重名模板' }),
    })
    const file = new File(['{"nodes":[]}'], 'wf.json')
    await act(async () => { await h.face.handleImportFile(file) })

    const confirm = h.dispatched.find((action) => action.type === 'CONFIRM_SET')
    expect(confirm).toBeDefined()
    expect(confirm).toMatchObject({ confirm: { kind: 'importConflict', kind2: 'workflow', name: '重名模板' } })
    expect(h.flowTemplatesLoaded).toBe(0)
  })

  it('角色模板 bundle 走 EP_IMPORT_AGENT_TEMPLATE（按 format 判定，不靠文件名）', async () => {
    const bundle = JSON.stringify({ format: TEMPLATE_FORMAT, template: { id: 'r-1' } })
    const h = await mountHarness(createInitialState('s-1'), {
      remoteResult: () => ({ conflict: false }),
    })
    const file = new File([bundle], 'role.json')
    await act(async () => { await h.face.handleImportFile(file) })

    const importCall = h.calls.find((c) => c.endpoint === EP.EP_IMPORT_AGENT_TEMPLATE)
    expect(importCall).toBeDefined()
    expect(importCall?.args.json).toBe(bundle)
    expect(h.templatesLoaded).toBe(1)
  })

  it('角色模板 bundle 导入成功：刷新角色模板列表（不与工作流模板列表混淆）', async () => {
    const bundle = JSON.stringify({ format: TEMPLATE_FORMAT, template: { id: 'r-9' } })
    const h = await mountHarness(createInitialState('s-1'), { remoteResult: () => ({ conflict: false }) })
    const file = new File([bundle], 'role.json')
    await act(async () => { await h.face.handleImportFile(file) })

    expect(h.templatesLoaded).toBe(1)
    expect(h.flowTemplatesLoaded).toBe(0)
    expect(h.notified).toEqual([{ kind: 'success', text: dict.toastImported }])
  })

  it('导入失败：走 toastError，不刷新列表', async () => {
    const failure = new Error('解析失败')
    const h = await mountHarness(createInitialState('s-1'), { remoteError: failure })
    const file = new File(['{oops'], 'bad.json')
    await act(async () => { await h.face.handleImportFile(file) })

    expect(h.errors).toEqual([failure])
    expect(h.templatesLoaded).toBe(0)
    expect(h.flowTemplatesLoaded).toBe(0)
  })

  it('重名冲突后选择 rename / overwrite：把模式原样传给后端并刷新列表', async () => {
    const h = await mountHarness(createInitialState('s-1'), {
      remoteResult: () => ({ conflict: false }),
    })
    const conflictState: StudioState = {
      ...createInitialState('s-1'),
      confirm: { kind: 'importConflict', kind2: 'workflow', json: '{"nodes":[]}', name: '重名模板', message: 'x' },
    }
    h.setState(conflictState)
    await act(async () => { await h.face.resolveImportConflict('overwrite') })

    const call = h.calls.find((c) => c.endpoint === EP.EP_IMPORT_WORKFLOW)
    expect(call?.args).toEqual({ json: '{"nodes":[]}', conflictMode: 'overwrite' })
    expect(h.flowTemplatesLoaded).toBe(1)
    // 确认框在任何路径上都被清空（避免残留弹窗）
    expect(h.dispatched.some((action) => action.type === 'CONFIRM_SET' && action.confirm === null)).toBe(true)
  })

  it('确认框已不存在时调用 resolveImportConflict：不发请求（防重复导入）', async () => {
    const h = await mountHarness(createInitialState('s-1'))
    await act(async () => { await h.face.resolveImportConflict('rename') })
    expect(h.calls).toEqual([])
  })
})

describe('useStudioTransfer · .md 加载与任务路径追加', () => {
  it('角色 System Prompt 加载：写入 systemPrompt 并记录来源文件名', async () => {
    const h = await mountHarness(createInitialState('s-1'))
    const file = new File(['你是分析员。'], 'persona.md', { type: 'text/markdown' })
    await act(async () => { await h.face.onPersonaMdSelected(file) })

    expect(h.patches).toEqual([{ systemPrompt: '你是分析员。', systemPromptSource: 'persona.md' }])
    expect(h.notified).toEqual([{ kind: 'success', text: dict.toastSaved }])
  })

  it('协作 Prompt 加载：写入 collabPrompt', async () => {
    const h = await mountHarness(createInitialState('s-1'))
    const file = new File(['协作规则'], 'group.md')
    await act(async () => { await h.face.onGroupMdSelected(file) })

    expect(h.patches).toEqual([{ collabPrompt: '协作规则' }])
  })

  it('任务描述：多选文件按行追加路径（已有描述保留，不上传）', async () => {
    const h = await mountHarness(createInitialState('s-1'), {
      editorData: { kind: 'task', data: { content: '已有描述' }, name: '任务', nodeId: 'n-1' },
    })
    act(() => { h.face.pickFiles([new File(['aaa'], 'a.txt'), new File(['bbb'], 'b.txt')]) })

    expect(h.calls).toEqual([])
    expect(h.patches).toEqual([{ content: '已有描述\na.txt\nb.txt' }])
  })

  it('任务描述：优先写入 Electron 暴露的 File.path', async () => {
    const h = await mountHarness(createInitialState('s-1'), {
      editorData: { kind: 'task', data: { content: '' }, name: '任务', nodeId: 'n-1' },
    })
    const file = new File(['x'], 'a.txt')
    Object.defineProperty(file, 'path', { value: 'D:/ws/a.txt' })
    act(() => { h.face.pickFiles([file]) })

    expect(h.patches).toEqual([{ content: 'D:/ws/a.txt' }])
  })

  it('任务描述：空 content 直接写路径，不产生前导换行；空选择不产生补丁', async () => {
    const h = await mountHarness(createInitialState('s-1'), {
      editorData: { kind: 'task', data: {}, name: '任务', nodeId: 'n-1' },
    })
    act(() => { h.face.pickFiles([new File(['x'], 'a.txt')]) })
    act(() => { h.face.pickFiles([]) })

    expect(h.patches).toEqual([{ content: 'a.txt' }])
  })

  it('数据库节点：EP_DB_TEST 成功提示 / 失败走 error 提示且带后端文案', async () => {
    const ok = await mountHarness(stateWithNode('database', {}))
    await act(async () => { await ok.face.testDbConnection() })
    expect(ok.calls.map((c) => c.endpoint)).toEqual([EP.EP_DB_TEST])
    expect(ok.notified).toEqual([{ kind: 'success', text: dict.dbTestSuccess }])

    const failure = new Error('连不上库')
    const bad = await mountHarness(stateWithNode('database', {}), { remoteError: failure })
    await act(async () => { await bad.face.testDbConnection() })
    expect(bad.notified).toEqual([{ kind: 'error', text: '连不上库' }])
  })
})
