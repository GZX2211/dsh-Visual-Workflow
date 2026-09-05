// tests/host/instantiate-new-session.test.ts
//
// 「开启新会话 + 工作区」数据模型单测（工作台全局化改版）：
//   - 模板 → 实例**不再继承** startNewSession/workspacePath（一次性临时选项，
//     字段已退役——实例文档不携带）；
//   - 覆盖语义：overwriteInstanceFromTemplate 复用既有实例 id（每会话单实例）；
//   - 工作区路径校验（resolveWorkspacePath：存在目录通过 / 不存在报错 / 空值忽略）。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { instantiateFromTemplate, overwriteInstanceFromTemplate } from '../../src/host/scheduler/instantiate.js'
import { resolveWorkspacePath } from '../../src/host/workspace/verify.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../src/host/shared/graph-model.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

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

describe('resolveWorkspacePath', () => {
  it('存在的目录：通过并返回原路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-ws-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    expect(await resolveWorkspacePath(dir)).toBe(dir)
  })

  it('空值/空白：返回 undefined（未配置）', async () => {
    expect(await resolveWorkspacePath('')).toBeUndefined()
    expect(await resolveWorkspacePath(undefined)).toBeUndefined()
    expect(await resolveWorkspacePath('   ')).toBeUndefined()
  })

  it('不存在的路径：明确报错（含路径提示）', async () => {
    await expect(resolveWorkspacePath('D:\\no-such-dir-xyz\\abc')).rejects.toThrow(/工作区路径不存在或不可访问/)
  })

  it('文件而非目录：报错（须为目录）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-ws-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'a.txt')
    await (await import('node:fs/promises')).writeFile(file, 'x', 'utf8')
    await expect(resolveWorkspacePath(file)).rejects.toThrow(/不是目录/)
  })
})
