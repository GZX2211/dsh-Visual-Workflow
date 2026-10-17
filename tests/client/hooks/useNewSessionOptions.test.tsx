// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useNewSessionOptions.test.tsx
//
// 「开启新会话」+ 工作区路径交互编排 hook 单测：
//   - 模板态：勾选/路径变更走 setFlowTemplateOptions（模板级持久化配置，变更即保存）；
//   - 资产态：仅勾选走 INSTANCE_OPTIONS_SET（一次性临时选项），无路径选择；
//   - 目录选择：经注入的官方选择器；取消不改值；失败提示；不可用时提示词典文案；
//   - 选择中防重入、卸载后不写状态（异步归属校验）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { createInitialState, type StudioAction, type StudioState } from '../../../src/client/studio/studio-state.js'
import {
  useNewSessionOptions,
  type NewSessionOptionsFace,
  type UseNewSessionOptionsArgs,
} from '../../../src/client/hooks/useNewSessionOptions.js'
import type { WorkspacePicker } from '../../../src/client/sidebar/workspace-picker.js'
import { zh } from '../../../src/client/i18n.js'
import { deferred } from '../fixtures/studio-harness.js'
import type { WorkflowTemplate } from '../../../src/host/shared/graph-model.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

const TEMPLATE: WorkflowTemplate = {
  id: 'tpl-1', mode: 'mode1', name: '模板', description: '', nodes: [], lines: [],
  startNewSession: true, workspacePath: 'D:\\template\\ws',
}

/** 模板态现场（勾选与路径为模板持久化字段）。 */
function templateState(partial: Partial<StudioState> = {}): StudioState {
  return {
    ...createInitialState('s-1'),
    currentKind: 'flowTemplate',
    currentId: TEMPLATE.id,
    flowTemplates: [TEMPLATE],
    ...partial,
  }
}

/** 资产态现场（无模板文档：只有一次性临时勾选）。 */
function assetState(partial: Partial<StudioState> = {}): StudioState {
  return {
    ...createInitialState('s-1'),
    currentKind: 'flowAsset',
    currentId: 'a-1',
    assetDoc: {
      assetId: 'a-1', versionId: 1, rowId: 'a-1@1', mode: 'mode1', name: '资产', description: '',
      nodes: [], lines: [], roleVersionIds: [], createdAt: 1,
    } as unknown as StudioState['assetDoc'],
    ...partial,
  }
}

function fakePicker(pick: WorkspacePicker['pick'], available = true): WorkspacePicker {
  return { available: () => available, pick }
}

interface Harness {
  /** 每次渲染最新的交互面（getter：状态更新后读取到新 face，而不是首次渲染的旧闭包）。 */
  readonly face: NewSessionOptionsFace
  dispatched: StudioAction[]
  setFlowTemplateOptions: ReturnType<typeof vi.fn<(patch: { startNewSession?: boolean; workspacePath?: string }) => Promise<void>>>
  notify: ReturnType<typeof vi.fn>
  toastError: ReturnType<typeof vi.fn>
}

/** 渲染 hook：state 固定（hook 只读其中切片），dispatch 记录。 */
async function renderHook(args: {
  state: StudioState
  picker?: WorkspacePicker | null
  setFlowTemplateOptions?: Harness['setFlowTemplateOptions']
}): Promise<Harness> {
  const dispatched: StudioAction[] = []
  const setFlowTemplateOptions = args.setFlowTemplateOptions ?? vi.fn(async () => {})
  const notify = vi.fn()
  const toastError = vi.fn()
  let face: NewSessionOptionsFace | null = null

  const dispatchRecorder = (action: StudioAction): void => { dispatched.push(action) }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Probe))
  })
  function Probe(): null {
    face = useNewSessionOptions({
      state: args.state,
      dispatch: dispatchRecorder as never,
      setFlowTemplateOptions,
      notify,
      toastError,
      picker: args.picker === undefined ? fakePicker(async () => 'D:\\picked', true) : args.picker,
      t: zh,
    })
    return null
  }
  return {
    get face() { return face! },
    dispatched,
    setFlowTemplateOptions,
    notify,
    toastError,
  }
}

describe('useNewSessionOptions：选项派生', () => {
  it('模板态：读模板持久化字段；显示选择器；可用性随官方选择器', async () => {
    const h = await renderHook({ state: templateState() })

    expect(h.face.options).toEqual({ newSession: true, workspacePath: 'D:\\template\\ws' })
    expect(h.face.showWorkspacePicker).toBe(true)
    expect(h.face.pickerAvailable).toBe(true)
    expect(h.face.picking).toBe(false)
  })

  it('官方选择器缺失：可用性为 false（按钮据此禁用并提示）', async () => {
    const h = await renderHook({ state: templateState(), picker: null })

    expect(h.face.showWorkspacePicker).toBe(true)
    expect(h.face.pickerAvailable).toBe(false)
  })

  it('资产态：勾选取一次性临时选项、路径恒空；不显示路径选择器', async () => {
    const h = await renderHook({ state: assetState({ instanceOptions: { newSession: true } }) })

    expect(h.face.options).toEqual({ newSession: true, workspacePath: '' })
    expect(h.face.showWorkspacePicker).toBe(false)
    expect(h.face.pickerAvailable).toBe(false)
  })
})

describe('useNewSessionOptions：选项变更归属', () => {
  it('模板态勾选/取消 → 保存模板配置（不写临时选项）', async () => {
    const h = await renderHook({ state: templateState({ flowTemplates: [{ ...TEMPLATE, startNewSession: false }] }) })

    act(() => { h.face.onOptionsChange({ newSession: true }) })

    expect(h.setFlowTemplateOptions).toHaveBeenCalledWith({ startNewSession: true })
    expect(h.dispatched.filter((action) => action.type === 'INSTANCE_OPTIONS_SET')).toEqual([])
  })

  it('资产态勾选 → dispatch 临时选项（不触碰模板）', async () => {
    const h = await renderHook({ state: assetState() })

    act(() => { h.face.onOptionsChange({ newSession: true }) })

    expect(h.setFlowTemplateOptions).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([{ type: 'INSTANCE_OPTIONS_SET', options: { newSession: true } }])
  })

  it('模板态的路径变更不经 onOptionsChange 直接写模板（路径只能来自目录选择器）', async () => {
    const h = await renderHook({ state: templateState() })

    act(() => { h.face.onOptionsChange({ workspacePath: 'D:\\manual' }) })

    expect(h.setFlowTemplateOptions).not.toHaveBeenCalled()
    expect(h.dispatched).toEqual([])
  })
})

describe('useNewSessionOptions：目录选择', () => {
  it('选择成功 → 保存 workspacePath；选择中 picking=true，结束后复位', async () => {
    const gate = deferred<string | null>()
    const h = await renderHook({ state: templateState(), picker: fakePicker(() => gate.promise, true) })

    act(() => { h.face.onPickWorkspace() })
    expect(h.face.picking).toBe(true)

    await act(async () => {
      gate.resolve('D:\\picked')
      await gate.promise
    })
    expect(h.setFlowTemplateOptions).toHaveBeenCalledWith({ workspacePath: 'D:\\picked' })
    expect(h.face.picking).toBe(false)
  })

  it('取消（选择器返回 null）→ 不改变模板配置', async () => {
    const h = await renderHook({ state: templateState(), picker: fakePicker(async () => null, true) })

    await act(async () => { h.face.onPickWorkspace() })

    expect(h.setFlowTemplateOptions).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('选择器抛错 → 走错误提示（不伪装成取消）', async () => {
    const failure = new Error('dialog failed')
    const h = await renderHook({ state: templateState(), picker: fakePicker(async () => { throw failure }, true) })

    await act(async () => { h.face.onPickWorkspace() })

    expect(h.toastError).toHaveBeenCalledWith(failure)
    expect(h.setFlowTemplateOptions).not.toHaveBeenCalled()
  })

  it('选择器不可用 → 不打开选择器，提示词典文案', async () => {
    const pick = vi.fn(async () => 'D:\\never')
    const h = await renderHook({ state: templateState(), picker: fakePicker(pick, false) })

    act(() => { h.face.onPickWorkspace() })

    expect(pick).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith('error', zh.workspacePickerUnavailable)
  })

  it('选择中重复点击只打开一次（防重入）', async () => {
    const gate = deferred<string | null>()
    const pick = vi.fn(() => gate.promise)
    const h = await renderHook({ state: templateState(), picker: fakePicker(pick, true) })

    act(() => { h.face.onPickWorkspace() })
    act(() => { h.face.onPickWorkspace() })
    expect(pick).toHaveBeenCalledTimes(1)

    await act(async () => {
      gate.resolve(null)
      await gate.promise
    })
  })

  it('卸载后选择器晚到 → 不保存、不提示（异步结果按归属丢弃）', async () => {
    const gate = deferred<string | null>()
    const h = await renderHook({ state: templateState(), picker: fakePicker(() => gate.promise, true) })

    act(() => { h.face.onPickWorkspace() })
    act(() => { root!.unmount(); root = null })

    await act(async () => {
      gate.resolve('D:\\late')
      await gate.promise
    })

    expect(h.setFlowTemplateOptions).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
  })
})

/** 类型级守卫：参数形状与公开 face 保持稳定（编译即验证）。 */
const _argsShapeCheck: Pick<UseNewSessionOptionsArgs, 'state' | 'picker' | 't'> = {
  state: createInitialState('s'),
  picker: null,
  t: zh,
}
void _argsShapeCheck
