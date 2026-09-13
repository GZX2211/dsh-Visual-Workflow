// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/p4-experience.test.tsx
//
// P4 体验与沉淀（自主编排方案 §8 + §10 P4 验收）：
//   1. 父模板高亮 bug：library-model 的父代理模板卡 pinned=false（不再常驻 is-pinned）；
//   2. 父模板可编辑（D-20）：Inspector 不再渲染「父代理模板无独立属性」空态，
//      改用与角色模板相同的属性表单（preset 可改）；
//   3. 父模板保存路径：saveEditor 对 source='template' 只调模板库接口，**不改实例**；
//   4. 闸门可视化：ProxyForm 可切换 role，FlowNode 显示里程碑角标与样式 + 显示名；
//   5. 补丁来源标注：agentPatchedNodeIdsOf 派生 + FlowNode「AI 调整」角标。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { ProxyForm } from '../../src/client/components/panels/inspector/forms.js'
import { Inspector } from '../../src/client/components/panels/inspector/Inspector.js'
import { FlowNode } from '../../src/client/components/canvas/FlowNode.js'
import { buildLibraryModel } from '../../src/client/components/sidebar/library-model.js'
import { agentPatchedNodeIdsOf } from '../../src/client/studio/studio-selectors.js'
import { createInitialState } from '../../src/client/studio/studio-initial.js'
import { useEditorActions, type EditorActionsFace } from '../../src/client/hooks/useEditorActions.js'
import { zh } from '../../src/client/i18n.js'
import type { StudioState } from '../../src/client/studio/studio-types.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'

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

const copy = { ...zh, modeName: () => '标准' }
const presets = [{ id: 'standard', name: '标准' }, { id: 'minimal', name: '极简' }]
const models = [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: 'High' }] }]
const combos = [{ id: 'combo-a', name: '团队模式', tools: ['wf_ask'], mcpServers: [] }]

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

function proxyNode(data: Record<string, unknown>): unknown {
  return { id: 'n-m1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n-p1', data }
}

function renderFlowNode(node: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  return render(React.createElement(FlowNode, {
    node, copy, mode: 'mode1', selected: false, highlighted: false, dragging: false,
    runStatus: null, onPointerDown: () => {}, onHandlePointerDown: () => {}, onToggleSwap: () => {},
    ...extra,
  } as never))
}

describe('P4 虚拟节点表单（ProxyForm，闸门可视化）', () => {
  it('默认角色为「普通执行入口」；勾选后补丁 role=milestone', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: {}, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain(zh.proxyRoleExecutor)
    const box = container!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => { box.click() })
    expect(patches).toEqual([{ role: 'milestone' }])
  })

  it('已是闸门时勾选态为真；取消勾选写 role=null（退回 executor）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: { role: 'milestone' }, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    expect(container!.textContent).toContain(zh.proxyRoleMilestone)
    const box = container!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement
    expect(box.checked).toBe(true)
    await act(async () => { box.click() })
    expect(patches).toEqual([{ role: null }])
  })

  it('显示名输入写入 label（画布显示名）', async () => {
    const patches: Array<Record<string, unknown>> = []
    await render(React.createElement(ProxyForm, {
      data: { role: 'milestone' }, copy, onPatch: (patch: Record<string, unknown>) => patches.push(patch), mainLabel: 'CEO',
    } as never))
    const input = container!.querySelector('input[type="text"]') as HTMLInputElement
    await act(async () => {
      // React 受控输入必须走原型上的 value setter 再派发 input 事件，直接赋 value 不触发 onChange
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, '里程碑①：方案评审')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(patches.at(-1)).toEqual({ label: '里程碑①：方案评审' })
  })
})

describe('P4 画布角标（FlowNode）', () => {
  it('闸门虚拟节点：里程碑角标 + is-gate 样式 + 显示名', async () => {
    await renderFlowNode(proxyNode({ role: 'milestone', label: '里程碑①' }))
    const html = container!.innerHTML
    expect(html).toContain('is-gate')
    expect(container!.textContent).toContain(zh.proxyGateBadge)
    expect(container!.textContent).toContain('里程碑①')
  })

  it('普通虚拟节点：仍是「↻ 引用」，不带 is-gate', async () => {
    await renderFlowNode(proxyNode({}))
    expect(container!.innerHTML).not.toContain('is-gate')
    expect(container!.textContent).toContain('↻ 引用')
  })

  it('显示名为空时回退节点种类名（不渲染空白卡片）', async () => {
    await renderFlowNode(proxyNode({ role: 'milestone', label: '   ' }))
    expect(container!.textContent).toContain(String(zh.nodeKinds.agent))
  })

  it('agentPatched=true 时显示「AI 调整」角标', async () => {
    await renderFlowNode(proxyNode({}), { agentPatched: true })
    expect(container!.textContent).toContain(zh.agentPatchedBadge)
  })

  it('agentPatched 缺省时不显示该角标', async () => {
    await renderFlowNode(proxyNode({}))
    expect(container!.textContent).not.toContain(zh.agentPatchedBadge)
  })
})

describe('P4 父代理模板可编辑（Inspector，D-20）', () => {
  const common = {
    copy: zh,
    open: true,
    width: 320,
    presets,
    tools: [],
    models,
    combos,
    flowMeta: { nodeCount: 0, revision: 0 },
    onPatch: () => {},
    onDelete: () => {},
    onSave: () => {},
    onCopyProxy: () => {},
    onRemoveMember: () => {},
    onFileSelect: () => {},
    onLoadMd: () => {},
    onLoadGroupMd: () => {},
    onTestDb: () => {},
    saveDisabled: false,
    importBusy: false,
  }

  it('模板来源的父代理：渲染属性表单（含 preset 下拉），不再显示「无独立属性」空态', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { presetId: 'standard', label: 'CEO' }, name: 'CEO', isParent: true, template: true } as never,
    } as never))
    const text = container!.textContent ?? ''
    expect(text).not.toContain('父代理模板无独立属性')
    expect(text).toContain(zh.nodeKinds.parent)
    expect(container!.querySelectorAll('select').length).toBeGreaterThan(0)
  })

  it('画布父代理节点同样可编辑（isParent 且非模板）', async () => {
    await render(React.createElement(Inspector, {
      ...common,
      editorData: { kind: 'role', data: { presetId: 'standard', label: 'CEO' }, name: 'CEO', isParent: true, nodeId: 'n-p1' } as never,
    } as never))
    expect(container!.textContent).not.toContain('父代理模板无独立属性')
    expect(container!.querySelectorAll('select').length).toBeGreaterThan(0)
  })
})

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
    const dispatched: string[] = []
    let face: EditorActionsFace | null = null

    function Probe(): null {
      face = useEditorActions(
        state,
        ((action: { type: string }) => { dispatched.push(action.type) }) as never,
        (() => {}) as never,
        (() => {}) as never,
        zh,
        {} as never,
        {} as never,
        { saveTemplate: async (kind: string, template: { id: string }) => { saved.push({ kind, id: template.id }) } } as never,
        {} as never,
        {} as never,
        (async () => {}) as never,
        (() => {}) as never,
        (() => {}) as never,
        (() => {}) as never,
        (() => {}) as never,
        { locks: { isEdgeLocked: () => false } } as never,
      )
      return null
    }

    await render(React.createElement(Probe))
    await act(async () => { await face!.saveEditor() })
    expect(saved).toEqual([{ kind: 'role', id: 'tpl-parent' }])
    expect(dispatched).toEqual([])
  })
})

describe('P4 父模板卡高亮修复（buildLibraryModel）', () => {
  it('父代理模板卡 pinned=false（不再常驻 is-pinned 高亮）', () => {
    const model = buildLibraryModel({
      copy: zh,
      libTab: 'role',
      mode: 'mode1',
      workflows: [],
      currentSessionId: 's-1',
      flowTemplates: [],
      parentTemplate: { id: 'tpl-parent', name: 'CEO' } as never,
      roleTemplates: [],
      fileTemplates: [],
      databaseTemplates: [],
      groupTemplates: [],
      stageKinds: [],
      libSelection: null,
      modeName: () => '标准',
      onSelectWorkflow: () => {},
      onSelectFlowTemplate: () => {},
      onSelectLib: () => {},
      onPlaceTemplate: () => {},
      onPlaceTemplateIntoGroup: () => {},
      onPlaceStage: () => {},
      onPlaceGroup: () => {},
      onPlaceGroupFromTemplate: () => {},
      onPlaceParent: () => {},
      onCreateNew: () => {},
    })
    const parent = model.sections.find((section) => section.key === 'parent')
    expect(parent?.cards[0].pinned).toBe(false)
  })
})

describe('P4 代理补丁标注（agentPatchedNodeIdsOf）', () => {
  it('读取当前文档 lastPatch.nodeIds（去重 + 过滤空值 + 非数组安全）', () => {
    const base = createInitialState('s-1')
    const flow = {
      id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: 'F', description: '', revision: 2, nodes: [], lines: [],
      lastPatch: { origin: 'agent', at: '2026-09-01T00:00:00.000Z', nodeIds: ['a', 'a', '', 'b'] },
    } as unknown as WorkflowDocument
    const state: StudioState = { ...base, currentKind: 'workflow', currentId: 'wf-1', workflows: [flow] }
    expect(agentPatchedNodeIdsOf(state)).toEqual(['a', 'b'])
  })

  it('无 lastPatch（用户保存后）→ 空数组', () => {
    const base = createInitialState('s-1')
    const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: 'F', description: '', revision: 1, nodes: [], lines: [] } as unknown as WorkflowDocument
    const state: StudioState = { ...base, currentKind: 'workflow', currentId: 'wf-1', workflows: [flow] }
    expect(agentPatchedNodeIdsOf(state)).toEqual([])
  })

  it('模板态同样生效（代理改写模板时画布也有角标）', () => {
    const base = createInitialState('s-1')
    const template = {
      id: 'tpl-1', mode: 'mode1', name: 'T', description: '', revision: 1, nodes: [], lines: [],
      lastPatch: { origin: 'agent', at: '2026-09-01T00:00:00.000Z', nodeIds: ['n1'] },
    }
    const state: StudioState = { ...base, currentKind: 'flowTemplate', currentId: 'tpl-1', flowTemplates: [template as never] }
    expect(agentPatchedNodeIdsOf(state)).toEqual(['n1'])
  })
})