// tests/host/instantiate-new-session.test.ts
//
// 「开启新会话 + 工作区」数据模型单测（工作台全局化改版）：
//   - 模板 → 实例**不再继承** startNewSession/workspacePath（一次性临时选项，
//     字段已退役——实例文档不携带）；
//   - 覆盖语义：overwriteInstanceFromTemplate 复用既有实例 id（每会话单实例）。
// 工作区路径校验（resolveWorkspacePath）测试归其自身模块所在位置
// （tests/host/workspace-path.test.ts）。

import { describe, expect, it } from 'vitest'
import { instantiateFromTemplate, overwriteInstanceFromTemplate } from '../../src/host/scheduler/instantiate.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../src/host/shared/graph-model.js'

function template(extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: 'tpl-1',
    mode: 'mode1',
    name: '模板',
    description: '',
    nodes: [],
    lines: [],
    ...extra,
  }
}

function existing(extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id: 'wf-old',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '旧实例',
    description: '旧描述',
    revision: 3,
    nodes: [],
    lines: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    ...extra,
  }
}

describe('instantiateFromTemplate 新会话字段退役（不继承）', () => {
  it('模板 startNewSession/workspacePath 不再随实例化继承（一次性临时选项，不落盘）', () => {
    const instance = instantiateFromTemplate(
      template({ startNewSession: true, workspacePath: 'D:\\work\\tpl-ws' }),
      'session-1',
      [],
      { id: () => 'wf-1' },
    )
    expect(instance.startNewSession).toBeUndefined()
    expect(instance.workspacePath).toBeUndefined()
    expect(instance.sessionId).toBe('session-1')
  })

  it('模板未配置 → 实例不携带（undefined）', () => {
    const instance = instantiateFromTemplate(template(), 'session-1', [], { id: () => 'wf-1' })
    expect(instance.startNewSession).toBeUndefined()
    expect(instance.workspacePath).toBeUndefined()
  })
})

describe('overwriteInstanceFromTemplate 覆盖语义（每会话单实例）', () => {
  it('复用既有实例 id/sessionId/createdAt/revision；名称与内容 = 模板最新定义', () => {
    const flow = existing()
    const overwritten = overwriteInstanceFromTemplate(
      template({ name: '新模板', description: '新描述', nodes: [{ id: 'n-1', kind: 'start', position: { x: 0, y: 0 }, data: {} }] as never, lines: [] as never }),
      flow,
      { now: () => 1_000_000 },
    )
    expect(overwritten.id).toBe('wf-old')
    expect(overwritten.sessionId).toBe('session-1')
    expect(overwritten.createdAt).toBe('2026-08-20T00:00:00.000Z')
    expect(overwritten.revision).toBe(3)
    expect(overwritten.name).toBe('新模板')
    expect(overwritten.description).toBe('新描述')
    expect(overwritten.nodes).toHaveLength(1)
  })

  it('输出不携带启动时新会话/工作区字段（退役）', () => {
    const overwritten = overwriteInstanceFromTemplate(
      template({ startNewSession: true, workspacePath: 'D:\\work\\x' }),
      existing(),
    )
    expect(overwritten.startNewSession).toBeUndefined()
    expect(overwritten.workspacePath).toBeUndefined()
  })
})
