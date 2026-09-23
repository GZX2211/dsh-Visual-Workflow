// tests/client/studio/studio-selectors.test.ts
//
// studio 选择器单测：
//   ① P4 代理补丁来源标注：agentPatchedNodeIdsOf 读取当前文档 lastPatch.nodeIds
//      （去重 + 过滤空值 + 非数组安全）；无 lastPatch（用户保存后）→ 空数组；模板态同样生效；
//   ② 协作组成员显示名：memberLabelOf 的 fallback 规则（成员存在取 label、不存在回退 id、
//      label 为空字符串时不幻觉出名字）。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——studio-selectors 用例归入本文件。

import { describe, expect, it } from 'vitest'
import { agentPatchedNodeIdsOf, memberLabelOf } from '../../../src/client/studio/studio-selectors.js'
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
