// tests/host/api/workflows.test.ts
//
// 工作流与服务/会话来端点的边界职责（api/workflows.ts）：参数校验（400）、
// 会话归属校验（404/501）、revision 冲突（409）、响应形状与会话隔离契约。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import { cleanupAll, cleanups, makeFlow, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('工作流端点', () => {
  it('create/list/get/put/delete 全链路；参数缺失 400、不存在 404', async () => {
    const h = await makeHarness()
    // 工作台全局化：listWorkflows 无 sessionId = 列出全部会话实例（不再 400）
    expect((await h.api.handle('listWorkflows', {})) as unknown[]).toHaveLength(0)
    const created = (await h.api.handle('createWorkflow', { sessionId: 'session-1', name: '新流程' })) as WorkflowDocument
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('新流程')

    const list = (await h.api.handle('listWorkflows', { sessionId: 'session-1' })) as WorkflowDocument[]
    expect(list).toHaveLength(1)

    const got = await h.api.handle('getWorkflow', { sessionId: 'session-1', id: created.id })
    expect((got as WorkflowDocument).id).toBe(created.id)

    // revision 冲突 → 409（客户端基于旧 revision 提交）
    await h.store.saveWorkflow({ ...makeFlow(), name: '同名覆盖', id: created.id }, 'session-1', { force: true })
    await h.store.saveWorkflow({ ...makeFlow(), name: '同名覆盖2', id: created.id }, 'session-1', { force: true })
    await expect(
      h.api.handle('putWorkflow', { sessionId: 'session-1', flow: { ...makeFlow(), id: created.id, revision: 1 } }),
    ).rejects.toMatchObject({ status: 409 })

    const deleted = await h.api.handle('deleteWorkflow', { sessionId: 'session-1', id: created.id })
    expect(deleted).toEqual({ deleted: true })
    await expect(h.api.handle('deleteWorkflow', { sessionId: 'session-1', id: created.id })).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('getWorkflow', { sessionId: 'session-1', id: 'nope' })).rejects.toMatchObject({ status: 404 })
  })

  it('listWorkflows 工作台全局化：无 sessionId 返回全部会话实例；带 sessionId 仍按会话过滤', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await h.store.saveWorkflow({ ...makeFlow(), id: 'flow-other', name: '他会话流程' }, 'session-2', { force: true })
    const all = (await h.api.handle('listWorkflows', {})) as WorkflowDocument[]
    expect(all.map((f) => f.id).sort()).toEqual(['flow-1', 'flow-other'])
    expect(all.map((f) => f.sessionId).sort()).toEqual(['session-1', 'session-2'])
    const filtered = (await h.api.handle('listWorkflows', { sessionId: 'session-1' })) as WorkflowDocument[]
    expect(filtered.map((f) => f.id)).toEqual(['flow-1'])
  })

  it('putWorkflow：实例文档不再写入 startNewSession/workspacePath（退役字段剥除）', async () => {
    const h = await makeHarness()
    await h.api.handle('putWorkflow', {
      sessionId: 'session-1',
      flow: { ...makeFlow(), startNewSession: true, workspacePath: 'D:\\work\\legacy' },
    })
    const saved = (await h.api.handle('getWorkflow', { sessionId: 'session-1', id: 'flow-1' })) as WorkflowDocument
    expect(saved.startNewSession).toBeUndefined()
    expect(saved.workspacePath).toBeUndefined()
  })

  it('createSession：「开启新会话」一次性动作——显式工作区校验直传 / 缺省继承创建者 cwd / 能力缺失 501', async () => {
    const h = await makeHarness()
    const calls: Array<{ label: string; agentPreset?: string; cwd?: string }> = []
    h.host.sessionProvider = {
      async createSession(options) {
        calls.push(options)
        return 'session-new-1'
      },
    }
    // 显式工作区 → 校验存在为目录并直传（agentPreset=standard，标签可追溯）
    const ws = await mkdtemp(join(tmpdir(), 'vw-sess-ws-'))
    cleanups.push(() => rm(ws, { recursive: true, force: true }))
    const created = (await h.api.handle('createSession', {
      sessionId: 'session-1',
      workspacePath: ws,
      label: '工作流实例：测试模板',
    })) as { sessionId?: unknown }
    expect(created.sessionId).toBe('session-new-1')
    expect(calls[0]).toMatchObject({ cwd: ws, agentPreset: 'standard', label: '工作流实例：测试模板' })
    // 缺省工作区 → 继承创建者会话 cwd（sessionCwdOf 解析）
    h.host.sessionCwdOf = async () => 'D:\\work\\owner'
    await h.api.handle('createSession', { sessionId: 'session-1' })
    expect(calls[1]?.cwd).toBe('D:\\work\\owner')
    // 不存在的显式路径 → 400
    await expect(
      h.api.handle('createSession', { sessionId: 'session-1', workspacePath: 'D:\\no-such-dir-xyz\\abc' }),
    ).rejects.toMatchObject({ status: 400 })
    // 会话创建能力未装配 → 501
    const h2 = await makeHarness()
    await expect(h2.api.handle('createSession', { sessionId: 'session-1' })).rejects.toMatchObject({ status: 501 })
  })
})

describe('服务端点', () => {
  it('服务 CRUD；serviceStart 无服务管理器 → 501', async () => {
    const h = await makeHarness()
    const saved = (await h.api.handle('putService', {
      sessionId: 'session-1',
      service: {
        id: 'svc-1',
        sessionId: 'session-1',
        name: '服务A',
        description: '',
        revision: 0,
        nodes: [],
        lines: [],
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
        status: 'stopped',
      },
    })) as { id?: string }
    expect(saved.id).toBe('svc-1')
    const list = (await h.api.handle('listServices', { sessionId: 'session-1' })) as unknown[]
    expect(list).toHaveLength(1)
    // 无 sessionId → 400（会话归属必填）
    await expect(h.api.handle('serviceStart', { serviceId: 'svc-1' })).rejects.toMatchObject({ status: 400 })
    // 跨会话启动 → 404（越权会话不得启动他人服务）
    await expect(h.api.handle('serviceStart', { sessionId: 'session-other', serviceId: 'svc-1' })).rejects.toMatchObject({ status: 404 })
    // 归属匹配但管理器未装配 → 501
    await expect(h.api.handle('serviceStart', { sessionId: 'session-1', serviceId: 'svc-1' })).rejects.toMatchObject({
      status: 501,
      code: 'WF_SERVICE_MANAGER_UNAVAILABLE',
    })
    // 管理器装配后：返回「文档为基 + 运行时字段合并」的完整服务状态（Bug 22），
    // 而非 manager 返回的残缺结果——前端 SERVICE_UPDATED 需要完整 ServiceState。
    const calls: string[] = []
    h.host.serviceManager = {
      start: async (id) => { calls.push(`start:${id}`); return { started: true } },
      stop: async () => ({}),
      status: async () => ({}),
    }
    const started = await h.api.handle('serviceStart', { sessionId: 'session-1', serviceId: 'svc-1' })
    // manager 未提供运行时字段时回退文档原状：完整字段（id/name/revision/nodes/lines）不得丢失
    expect(started).toMatchObject({ id: 'svc-1', name: '服务A', revision: 1, nodes: [], lines: [] })
    expect(calls).toEqual(['start:svc-1'])
  })

  it('serviceStart/stop 返回完整服务状态（Bug 22：manager 残缺结果不得替换列表项）', async () => {
    const h = await makeHarness()
    await h.api.handle('putService', {
      sessionId: 'session-1',
      service: {
        id: 'svc-2',
        sessionId: 'session-1',
        name: '服务B',
        description: 'desc',
        revision: 0,
        nodes: [{ id: 'n1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '输入' } }],
        lines: [],
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
        status: 'stopped',
      },
    })
    // manager 只返回运行时字段（与真实 ServiceManager.start/stop 形态一致：
    // { serviceId, status, port, pid }——缺 id/name/nodes/lines/revision/sessionId）
    h.host.serviceManager = {
      start: async () => ({ serviceId: 'svc-2', status: 'running', port: 7860, pid: 4242 }),
      stop: async () => ({ serviceId: 'svc-2', status: 'stopped' }),
      status: async () => ({ serviceId: 'svc-2', status: 'running', port: 7860 }),
    }
    const started = (await h.api.handle('serviceStart', { sessionId: 'session-1', serviceId: 'svc-2' })) as Record<string, unknown>
    // 完整字段保留 + 运行时字段合并（前端 SERVICE_UPDATED 直接可用，不污染列表项）
    expect(started).toMatchObject({
      id: 'svc-2',
      sessionId: 'session-1',
      name: '服务B',
      revision: 1,
      status: 'running',
      port: 7860,
      nodes: [{ id: 'n1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '输入' } }],
      lines: [],
    })
    expect(started.pid).toBe(4242)
    const stopped = (await h.api.handle('serviceStop', { sessionId: 'session-1', serviceId: 'svc-2' })) as Record<string, unknown>
    expect(stopped).toMatchObject({ id: 'svc-2', name: '服务B', status: 'stopped', revision: 1 })
  })
})
