// tests/client/studio/studio-selectors.test.ts
//
// studio 选择器单测：
//   ① P4 代理补丁来源标注：agentPatchedNodeIdsOf 读取当前文档 lastPatch.nodeIds
//      （去重 + 过滤空值 + 非数组安全）；无 lastPatch（用户保存后）→ 空数组；模板态同样生效；
//   ② 协作组成员显示名：memberLabelOf 的 fallback 规则（成员存在取 label、不存在回退 id、
//      label 为空字符串时不幻觉出名字）；
//   ③ editorDataOf 的资产语义投影：归档标记（决定归档按钮是否置灰）与画布角色节点的
//      来源资产绑定（决定是否给出与左侧栏一致的回滚按钮）。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——studio-selectors 用例归入本文件。

import { describe, expect, it } from 'vitest'
import { agentPatchedNodeIdsOf, editorDataOf, memberLabelOf } from '../../../src/client/studio/studio-selectors.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import type { CanvasNode, StudioState } from '../../../src/client/studio/studio-types.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'

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

describe('协作组成员显示名（memberLabelOf）', () => {
  function member(label?: unknown): CanvasNode {
    return { id: 'm-1', kind: 'agent', position: { x: 0, y: 0 }, data: label === undefined ? {} : { label } } as CanvasNode
  }

  it('成员存在 → 取成员 label', () => {
    expect(memberLabelOf(member('研究员'), 'm-1')).toBe('研究员')
  })

  it('成员不存在（已被删除的成员 id）→ 回退成员 id', () => {
    expect(memberLabelOf(undefined, 'm-gone')).toBe('m-gone')
  })

  it('成员存在但 label 为空字符串 → 原样返回空串（不回退 id：id 不是显示名）', () => {
    expect(memberLabelOf(member(''), 'm-1')).toBe('')
  })
})

describe('编辑器数据投影（editorDataOf 的资产语义）', () => {
  const base = createInitialState('s-1')

  it('工作流资产：归档标记随详情透出（属性栏据此置灰归档按钮）', () => {
    const opened: StudioState = {
      ...base,
      editor: { source: 'flowAsset', id: 'a-1' },
      assetDoc: { assetId: 'a-1', versionId: 2, rowId: 'a-1@2', mode: 'mode1', name: '资产一', description: '', nodes: [], lines: [], roleVersionIds: [], createdAt: 1, retired: true } as never,
    }
    expect(editorDataOf(opened)).toMatchObject({ asset: true, assetId: 'a-1', retired: true })

    const active: StudioState = { ...opened, assetDoc: { ...opened.assetDoc!, retired: undefined } as never }
    expect(editorDataOf(active)?.retired).toBeUndefined()
  })

  it('角色资产：归档标记随详情透出', () => {
    const opened: StudioState = {
      ...base,
      editor: { source: 'roleAsset', id: 'a-r1' },
      assetRoleDoc: {
        assetId: 'a-r1', versionId: 1, rowId: 'a-r1@1', kind: 'agent', roleAssetType: 'standalone',
        name: '角色', systemPrompt: '', provider: '', model: '', retryLimit: 3,
        referenceWorkflowIds: [], createdAt: 1, retired: true,
      } as never,
    }
    expect(editorDataOf(opened)).toMatchObject({ roleAsset: true, assetId: 'a-r1', retired: true })
  })

  it('画布角色节点：有来源资产绑定即透出 sourceAssetId（回滚按钮判据）', () => {
    const bound: CanvasNode = {
      id: 'n-1', kind: 'agent', position: { x: 0, y: 0 },
      data: { label: '子代理', systemPrompt: '', provider: '', model: '', retryLimit: 3, sourceAssetId: 'a-r1' },
    }
    const state: StudioState = { ...base, editor: { source: 'node', id: 'n-1' }, canvas: { nodes: [bound], edges: [] } }
    expect(editorDataOf(state)).toMatchObject({ kind: 'role', nodeId: 'n-1', sourceAssetId: 'a-r1' })

    const unbound: CanvasNode = { ...bound, data: { ...bound.data, sourceAssetId: undefined } }
    const plain: StudioState = { ...state, canvas: { nodes: [unbound], edges: [] } }
    expect(editorDataOf(plain)?.sourceAssetId).toBeUndefined()
  })
})
