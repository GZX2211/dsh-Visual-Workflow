// tests/host/api/templates.test.ts
//
// 模板与工作流模板端点的边界职责（api/templates.ts）：kind 参数校验（400）、
// 删除 404、revision 乐观锁（409）。

import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('模板端点（角色/任务/数据库）', () => {
  it('模板 CRUD：kind 校验 400、保存/列表往返、删除 404', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('listTemplates', { kind: 'bad' })).rejects.toMatchObject({ status: 400 })
    const saved = (await h.api.handle('putTemplate', {
      kind: 'role',
      template: { id: 'role-1', kind: 'agent', name: '研究员', systemPrompt: 'x', provider: '', model: '', presetId: 'standard', retryLimit: 3 },
    })) as { id?: string }
    expect(saved.id).toBe('role-1')
    const list = (await h.api.handle('listTemplates', { kind: 'role' })) as unknown[]
    expect(list).toHaveLength(1)

    const deleted = await h.api.handle('deleteTemplate', { kind: 'role', id: 'role-1' })
    expect(deleted).toEqual({ deleted: true })
    await expect(h.api.handle('deleteTemplate', { kind: 'role', id: 'role-1' })).rejects.toMatchObject({ status: 404 })
  })

  it('任务模板：kind=task 保存/列表往返，旧受管字段不落盘', async () => {
    const h = await makeHarness()
    const saved = (await h.api.handle('putTemplate', {
      kind: 'task',
      template: { id: 'task-1', name: '任务一', content: '正文', fileKind: 'file', managedPath: 'data/files/x.md' },
    })) as { id?: string; content?: string }
    expect(saved.id).toBe('task-1')
    expect(saved.content).toBe('正文')

    const list = (await h.api.handle('listTemplates', { kind: 'task' })) as Array<Record<string, unknown>>
    expect(list.map((item) => item.id)).toEqual(['task-1'])
    expect(list[0]).not.toHaveProperty('fileKind')
    expect(list[0]).not.toHaveProperty('managedPath')
  })
})

describe('工作流模板端点', () => {
  it('工作流模板端点 CRUD（图2 改造：全局共享，无会话隔离）', async () => {
    const h = await makeHarness()
    // 初态为空
    expect(await h.api.handle('listFlowTemplates', {})).toEqual([])

    // 保存（revision 0 → 1）
    const saved = (await h.api.handle('putFlowTemplate', {
      template: { id: 'tpl-1', mode: 'mode1', name: '流程模板', description: 'd', revision: 0, nodes: [], lines: [] },
    })) as { id?: string; revision?: number }
    expect(saved.id).toBe('tpl-1')
    expect(saved.revision).toBe(1)

    // 乐观锁：携带过期的 expected revision 保存被拒（409）
    await expect(h.api.handle('putFlowTemplate', {
      template: { id: 'tpl-1', mode: 'mode1', name: '旧快照', description: '', revision: 99, nodes: [], lines: [] },
    })).rejects.toMatchObject({ status: 409 })

    // 列表可见（无 sessionId 参数——全局共享）
    const list = (await h.api.handle('listFlowTemplates', {})) as unknown[]
    expect(list).toHaveLength(1)

    // 删除与 404
    expect(await h.api.handle('deleteFlowTemplate', { id: 'tpl-1' })).toEqual({ deleted: true })
    await expect(h.api.handle('deleteFlowTemplate', { id: 'tpl-1' })).rejects.toMatchObject({ status: 404 })
  })

  it('模板级新会话配置：startNewSession/workspacePath 随模板持久化（trim 后保留）', async () => {
    const h = await makeHarness()
    const saved = (await h.api.handle('putFlowTemplate', {
      template: {
        id: 'tpl-ws', mode: 'mode1', name: '带工作区模板', description: '', revision: 0, nodes: [], lines: [],
        startNewSession: true,
        workspacePath: '  D:\\work\\ws  ',
      },
    })) as { startNewSession?: boolean; workspacePath?: string }

    expect(saved.startNewSession).toBe(true)
    expect(saved.workspacePath).toBe('D:\\work\\ws')

    // 列表回读同样保留（持久化而非仅本次响应）
    const list = (await h.api.handle('listFlowTemplates', {})) as Array<{ startNewSession?: boolean; workspacePath?: string }>
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ startNewSession: true, workspacePath: 'D:\\work\\ws' })

    // 未勾选 / 空白路径 → 归一化为「无该配置」（不落空串/ false 噪音字段）
    const cleared = (await h.api.handle('putFlowTemplate', {
      template: {
        id: 'tpl-ws', mode: 'mode1', name: '带工作区模板', description: '', revision: 1, nodes: [], lines: [],
        startNewSession: false,
        workspacePath: '   ',
      },
    })) as { startNewSession?: boolean; workspacePath?: string }
    expect(cleared.startNewSession).toBeUndefined()
    expect(cleared.workspacePath).toBeUndefined()
  })

  it('模板级新会话配置不校验目录存在性（选择器保证，创建实例时由 createSession 校验）', async () => {
    const h = await makeHarness()
    const saved = (await h.api.handle('putFlowTemplate', {
      template: {
        id: 'tpl-missing', mode: 'mode1', name: '失效路径模板', description: '', revision: 0, nodes: [], lines: [],
        startNewSession: true,
        workspacePath: 'Z:\\no-such-dir-xyz\\project',
      },
    })) as { workspacePath?: string }
    expect(saved.workspacePath).toBe('Z:\\no-such-dir-xyz\\project')
  })
})
