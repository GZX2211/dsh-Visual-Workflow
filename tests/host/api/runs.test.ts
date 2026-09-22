// tests/host/api/runs.test.ts
//
// 运行、数据库与导入导出端点组的边界职责（api/runs.ts）：会话归属校验（400/404）、
// 断点续跑语义、数据库面板三端点、导入导出的参数校验与领域码透传
// （导入导出领域行为见 tests/host/transfer/bundle.test.ts）。

import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanupAll, databaseNode, makeFlow, makeHarness, saveFlow } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('运行端点', () => {
  it('run 无断点全新启动；有断点自动续跑（resumedFromRunId）', async () => {
    const h = await makeHarness()
    await saveFlow(h)
    const started = await h.api.handle('run', { sessionId: 'session-1', flowId: 'flow-1' })
    expect((started as { runId?: string }).runId).toBe('run-1')

    // 构造 paused 断点：a1 ok → 暂停门
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-a1' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A 产出' }] })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-pause' })

    // run 端点自动续跑（新 run-2，继承链指向 run-1）
    const resumed = await h.api.handle('run', { sessionId: 'session-1', flowId: 'flow-1' })
    expect(resumed).toMatchObject({ runId: 'run-2', resumedFromRunId: 'run-1' })
  })

  it('runStatus：运行中内存快照；终态回退磁盘；未知 404', async () => {
    const h = await makeHarness()
    await saveFlow(h)
    await h.api.handle('run', { sessionId: 'session-1', flowId: 'flow-1' })
    const status = (await h.api.handle('runStatus', { sessionId: 'session-1', runId: 'run-1' })) as { id?: string; status?: string }
    expect(status.id).toBe('run-1')
    expect(status.status).toBe('running')

    // 无 sessionId → 400；跨会话 → 404（会话归属校验）
    await expect(h.api.handle('runStatus', { runId: 'run-1' })).rejects.toMatchObject({ status: 400 })
    await expect(h.api.handle('runStatus', { sessionId: 'session-other', runId: 'run-1' })).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('runStop', { sessionId: 'session-other', runId: 'run-1' })).rejects.toMatchObject({ status: 404 })

    await h.api.handle('runStop', { sessionId: 'session-1', runId: 'run-1' })
    // 终态条目内存已释放 → 回退磁盘历史
    const disk = (await h.api.handle('runStatus', { sessionId: 'session-1', runId: 'run-1' })) as { status?: string }
    expect(disk.status).toBe('stopped')

    await expect(h.api.handle('runStatus', { sessionId: 'session-1', runId: 'run-nope' })).rejects.toMatchObject({ status: 404 })
  })

  it('activeRuns：活跃 run 列表（running/paused 保留锁；工作台全局化：缺省返回全部会话）', async () => {
    const h = await makeHarness()
    await saveFlow(h)
    await h.api.handle('run', { sessionId: 'session-1', flowId: 'flow-1' })
    // running 中：应返回该 flowId
    const runningRuns = (await h.api.handle('activeRuns', { sessionId: 'session-1' })) as Array<{ flowId: string; status: string; runId: string }>
    expect(runningRuns).toHaveLength(1)
    expect(runningRuns[0]).toMatchObject({ flowId: 'flow-1', status: 'running', runId: 'run-1' })

    // 工作台全局化：无 sessionId → 返回全部会话的活跃 run（工作台全局面板数据源）
    const allRuns = (await h.api.handle('activeRuns', {})) as Array<{ flowId: string; sessionId: string }>
    expect(allRuns).toHaveLength(1)
    expect(allRuns[0]).toMatchObject({ flowId: 'flow-1', sessionId: 'session-1' })

    // 停止后：活跃列表为空
    await h.api.handle('runStop', { sessionId: 'session-1', runId: 'run-1' })
    expect((await h.api.handle('activeRuns', { sessionId: 'session-1' })) as unknown[]).toHaveLength(0)

    // 跨会话隔离：其他会话看不到本会话的活跃 run
    expect((await h.api.handle('activeRuns', { sessionId: 'session-other' })) as unknown[]).toHaveLength(0)
  })

  it('runStop/runHistory/runResume（显式恢复指定 runId）', async () => {
    const h = await makeHarness()
    await saveFlow(h)
    await h.api.handle('run', { sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.handleSubagentEnd({ id: 'child-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A' }] })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'n-pause' })

    // Bug 14：runHistory 必须携带 sessionId（会话隔离契约）
    await expect(h.api.handle('runHistory', { flowId: 'flow-1' })).rejects.toMatchObject({ status: 400 })
    const history = (await h.api.handle('runHistory', { sessionId: 'session-1', flowId: 'flow-1' })) as Array<{ id?: string }>
    expect(history.some((run) => run.id === 'run-1')).toBe(true)
    // 跨会话不可见：其他会话查询同一 flowId 查不到 run
    const other = (await h.api.handle('runHistory', { sessionId: 'session-other', flowId: 'flow-1' })) as Array<{ id?: string }>
    expect(other.some((run) => run.id === 'run-1')).toBe(false)

    const resumed = await h.api.handle('runResume', { sessionId: 'session-1', flowId: 'flow-1', runId: 'run-1' })
    expect(resumed).toMatchObject({ runId: 'run-2', resumedFromRunId: 'run-1' })

    const stopped = await h.api.handle('runStop', { sessionId: 'session-1', runId: 'run-2' })
    expect(stopped).toEqual({ stopped: true })
  })

  it('runResume 无断点 → 端点错误透传（WF_NO_RESUME_POINT）', async () => {
    const h = await makeHarness()
    await saveFlow(h)
    await expect(h.api.handle('runResume', { sessionId: 'session-1', flowId: 'flow-1' })).rejects.toMatchObject({
      code: 'WF_NO_RESUME_POINT',
    })
  })
})

// ---------------------------------------------------------------------------
// 数据库端点
// ---------------------------------------------------------------------------

describe('数据库端点', () => {
  it('dbTest/dbSchema/dbSearchPreview：本地 sqlite 全链路（缺索引自动构建）', async () => {
    const h = await makeHarness()
    const dbFile = join(h.dataDir, 'test.db')
    const sqlite = new DatabaseSync(dbFile)
    sqlite.exec('CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT)')
    sqlite.prepare('INSERT INTO docs (title, body) VALUES (?, ?)').run('报告', '这是一份关于断点续跑的技术报告')
    sqlite.close()

    const node = databaseNode('n-db1', dbFile)
    const test = await h.api.handle('dbTest', { node })
    expect(test).toEqual({ ok: true, message: '连接成功' })

    const schema = (await h.api.handle('dbSchema', { node })) as Array<{ name?: string }>
    expect(schema.some((t) => t.name === 'docs')).toBe(true)

    // 缺索引 → 自动构建后检索
    const preview = (await h.api.handle('dbSearchPreview', { dataId: 'n-db1', query: '断点续跑', node })) as { hits?: unknown[] }
    expect(preview.hits).toBeTruthy()

    // rebuild=true 强制重建
    const rebuilt = (await h.api.handle('dbSearchPreview', { dataId: 'n-db1', query: '', node, rebuild: true })) as { hits?: unknown[] }
    expect(rebuilt.hits).toEqual([])

    await expect(h.api.handle('dbSearchPreview', { dataId: 'nope', query: 'x' })).rejects.toMatchObject({ status: 422 })
  })
})

// ---------------------------------------------------------------------------
// 导入导出端点（边界职责：参数校验与领域码透传；领域行为见 transfer 模块测试）
// ---------------------------------------------------------------------------

describe('导入导出端点', () => {
  it('exportWorkflow/exportAgentTemplate：参数缺失 400；目标不存在 → 领域码透传', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('exportWorkflow', { sessionId: 'session-1' })).rejects.toMatchObject({ status: 400 })
    await expect(h.api.handle('exportAgentTemplate', {})).rejects.toMatchObject({ status: 400 })
    await expect(h.api.handle('exportWorkflow', { sessionId: 'session-1', id: 'nope' })).rejects.toMatchObject({
      code: 'TRANSFER_NOT_FOUND',
    })
    await expect(h.api.handle('exportAgentTemplate', { id: 'nope' })).rejects.toMatchObject({ code: 'TRANSFER_NOT_FOUND' })
  })

  it('importWorkflow/importAgentTemplate：非法文件透传领域码（HTTP 映射见路由注册用例）', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('importWorkflow', { json: 'not-json' })).rejects.toMatchObject({ code: 'TRANSFER_INVALID_JSON' })
    await expect(h.api.handle('importWorkflow', { json: JSON.stringify({ format: 'x' }) })).rejects.toMatchObject({
      code: 'TRANSFER_INVALID_BUNDLE',
    })
    await expect(h.api.handle('importAgentTemplate', { json: 'not-json' })).rejects.toMatchObject({ code: 'TRANSFER_INVALID_JSON' })
    await expect(h.api.handle('importAgentTemplate', { json: JSON.stringify({ format: 'x' }) })).rejects.toMatchObject({
      code: 'TRANSFER_INVALID_BUNDLE',
    })
  })

  it('importWorkflow：端点把 bundle 落为工作流模板（不再创建实例）；conflictMode 透传', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    const { json } = (await h.api.handle('exportWorkflow', { sessionId: 'session-1', id: 'flow-1' })) as { json: string }
    const imported = (await h.api.handle('importWorkflow', { json })) as { template?: { name?: string } }
    expect(imported.template?.name).toBe('测试流程')
    // 实例数不变（只落模板），模板库 +1
    expect((await h.store.listWorkflows('session-1')).length).toBe(1)
    expect((await h.store.listFlowTemplates()).length).toBe(1)
  })
})
