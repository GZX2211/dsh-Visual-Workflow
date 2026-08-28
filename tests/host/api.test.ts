// tests/host/api.test.ts
//
// GUI API 层单测：
//   - 端点白名单与共享协议常量一致（零漂移）；未知端点 404；
//   - 工作流/服务/模板/组合端点：400/404/409 错误语义；
//   - 运行端点：run 自动续跑（有断点走 resume）、runStatus 内存+磁盘回退、
//     runStop/runHistory/runResume；
//   - 数据库端点：dbTest/dbSchema/dbSearchPreview（缺索引自动构建/rebuild）；
//   - 生态端点：presets/tools/models/pluginCatalog（fake 服务）；
//   - 导入导出：v2 bundle 冲突/rename/overwrite、角色模板往返；
//   - MCP 端点：托管区读写（DSH_HOME 指向临时目录）；
//   - 路由注册：disposer、非 POST 405、无效 JSON 400、服务端点无管理器 501、
//     受管文件下载（GET + 目录穿越拒绝）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { DatabaseSync } from 'node:sqlite'
import {
  OrchestratorRuntime,
  type AgentHost,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../src/host/orchestrator/runtime.js'
import * as EP from '../../src/host/shared/protocol.js'
import { VisualWorkflowApi, registerRoutes, type ApiHost } from '../../src/host/remote/api.js'
import { registerDownloadRoute, copyIntoManagedFile, managedFilePath } from '../../src/host/remote/download.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { DatabaseNode, RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import type { EmbeddingEngine } from '../../src/host/embedding/engine.js'

const cleanups: Array<() => Promise<void>> = []
const savedDshHome = process.env.DSH_HOME

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
})

function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-pause', 'pause'), agent('n-a2', '子任务B'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

function databaseNode(id: string, localPath: string): DatabaseNode {
  return {
    id,
    kind: 'database',
    position: { x: 0, y: 0 },
    data: { label: '本地库', description: '', dbType: 'local', dbKind: 'sqlite', localPath },
  }
}

class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  messages: RootInjectedMessage[] = []
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  available(): boolean {
    return true
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    ;(agent as FakeRoot).messages.push(message)
  }
  latestTurnEnd(): TurnEndInfo | null {
    return null
  }
  childRunning(): boolean {
    return false
  }
}

class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    return { childId: `child-${this.calls.length}`, created: true }
  }
  async interruptChild(): Promise<void> {}
}

/** 端点测试上下文（fake 生态服务可注入）。 */
interface CtxLike {
  get(name: string): unknown
}

class FakeCtx implements CtxLike {
  services = new Map<string, unknown>()
  get(name: string): unknown {
    return this.services.get(name)
  }
}

interface Harness {
  api: VisualWorkflowApi
  host: ApiHost
  runtime: OrchestratorRuntime
  store: FlowStore
  ctx: FakeCtx
  dataDir: string
}

async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-api-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runner = new FakeRunner()
  const runSeq = { n: 0 }
  const runtime = new OrchestratorRuntime({
    store,
    runner,
    agents,
    config: {
      outputFullLimit: 400,
      documentTextLimit: 200,
      runIdleTimeoutMs: 500,
      retryLimitDefault: 3,
      reactIterationLimitDefault: 50,
      wfAskAgentTimeoutMs: 500,
      ...config,
    },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    newRunId: () => {
      runSeq.n += 1
      return `run-${runSeq.n}`
    },
    uuid: () => `uuid-${runSeq.n}`,
  })
  const ctx = new FakeCtx()
  const engine: EmbeddingEngine = { source: 'bm25', dimension: 0, async embed() { throw new Error('bm25 only') }, dispose() {} }
  const host: ApiHost = { orchestrator: runtime, store, dataDir: dir, engine }
  const api = new VisualWorkflowApi(ctx, host)
  return { api, host, runtime, store, ctx, dataDir: dir }
}

/** 保存流程（供运行端点）。 */
async function saveFlow(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
}

// ---------------------------------------------------------------------------
// 白名单与分发
// ---------------------------------------------------------------------------

describe('端点白名单与分发', () => {
  it('白名单与共享协议常量完全一致（41 端点，零漂移）', () => {
    const expected = new Set<string>((Object.values(EP) as unknown[]).filter((v): v is string => typeof v === 'string'))
    expect(VisualWorkflowApi.ENDPOINTS.size).toBe(expected.size)
    for (const name of expected) expect(VisualWorkflowApi.ENDPOINTS.has(name)).toBe(true)
  })

  it('未知端点 404；原型链方法不可达', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('constructor', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('__proto__', {})).rejects.toMatchObject({ status: 404 })
    await expect(h.api.handle('noSuchEndpoint', {})).rejects.toMatchObject({ status: 404 })
  })
})

// ---------------------------------------------------------------------------
// 工作流端点
// ---------------------------------------------------------------------------

describe('工作流端点', () => {
  it('create/list/get/put/delete 全链路；参数缺失 400、不存在 404', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('listWorkflows', {})).rejects.toMatchObject({ status: 400 })

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
})

// ---------------------------------------------------------------------------
// 服务与模板端点
// ---------------------------------------------------------------------------

describe('服务与模板端点', () => {
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

  it('模板 CRUD 与删除预览（解耦语义：受影响节点恒为 0）', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('listTemplates', { kind: 'bad' })).rejects.toMatchObject({ status: 400 })
    const saved = (await h.api.handle('putTemplate', {
      kind: 'role',
      template: { id: 'role-1', kind: 'agent', name: '研究员', systemPrompt: 'x', provider: '', model: '', presetId: 'standard', retryLimit: 3 },
    })) as { id?: string }
    expect(saved.id).toBe('role-1')
    const list = (await h.api.handle('listTemplates', { kind: 'role' })) as unknown[]
    expect(list).toHaveLength(1)

    const preview = await h.api.handle('deleteTemplatePreview', { kind: 'role', id: 'role-1' })
    expect(preview).toEqual({ affectedNodes: 0, detached: true })

    const deleted = await h.api.handle('deleteTemplate', { kind: 'role', id: 'role-1' })
    expect(deleted).toEqual({ deleted: true })
    await expect(h.api.handle('deleteTemplate', { kind: 'role', id: 'role-1' })).rejects.toMatchObject({ status: 404 })
  })

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
})

// ---------------------------------------------------------------------------
// 组合端点
// ---------------------------------------------------------------------------

describe('组合端点', () => {
  it('toolComboPut 校验 combo- 前缀；CRUD 往返', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('toolComboPut', { combo: { id: 'bad', name: 'x' } })).rejects.toMatchObject({ status: 400 })
    const saved = await h.api.handle('toolComboPut', {
      combo: { id: 'combo-1', name: '研发组合', tools: ['read', 'write'], mcpServers: ['mcp-a'] },
    })
    expect((saved as { id?: string }).id).toBe('combo-1')
    const list = (await h.api.handle('toolCombos', {})) as unknown[]
    expect(list).toHaveLength(1)
    const deleted = await h.api.handle('toolComboDelete', { id: 'combo-1' })
    expect(deleted).toEqual({ deleted: true })
  })
})

// ---------------------------------------------------------------------------
// 生态端点
// ---------------------------------------------------------------------------

describe('生态端点', () => {
  it('presets/tools/models：fake 服务解析；缺失返回空', async () => {
    const h = await makeHarness()
    expect(await h.api.handle('presets', {})).toEqual([])
    expect(await h.api.handle('tools', {})).toEqual([])
    expect(await h.api.handle('models', {})).toEqual([])

    h.ctx.services.set('agentPresets', {
      list: async () => [
        { id: 'standard', name: '标准模式', description: '默认', trust: 'user' },
        { id: 'broken-one', broken: true },
      ],
    })
    const presets = (await h.api.handle('presets', {})) as Array<{ id?: string }>
    expect(presets).toHaveLength(1)
    expect(presets[0].id).toBe('standard')

    h.ctx.services.set('tools', {
      schemas: () => [{ name: 'read', description: 'Read a file.' }, { title: 'write' }],
    })
    const tools = (await h.api.handle('tools', {})) as Array<{ name?: string }>
    expect(tools.map((t) => t.name).sort()).toEqual(['read', 'write'])

    h.ctx.services.set('llm', {
      listProviders: () => ['p1'],
      listModels: async () => ['m1', { id: 'm2', name: '模型二' }],
    })
    const models = (await h.api.handle('models', {})) as Array<{ provider?: string; model?: string }>
    expect(models).toEqual([
      { provider: 'p1', model: 'm1' },
      { provider: 'p1', model: 'm2' },
    ])
  })

  it('pluginCatalog：工具并集（全局 + preset standing）+ 中文描述 + MCP 行', async () => {
    const h = await makeHarness()
    const mcpDir = join(h.dataDir, 'dsh-home')
    process.env.DSH_HOME = mcpDir
    await mkdir(join(mcpDir, 'profiles', 'web'), { recursive: true })
    await writeFile(
      join(mcpDir, 'profiles', 'web', 'cordis.patch.yml'),
      '# >>> dsh-visual-workflow\n- insert:\n    - id: mcp-demo\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        serverName: demo\n        transport: stdio\n        command: npx\n        args:\n          - "-y"\n          - demo-server\n# <<< dsh-visual-workflow\n',
      'utf8',
    )
    const presetKey = { presetScope: true }
    h.ctx.services.set('agentPresets', {
      list: async () => [{ id: 'standard' }],
      standingKeyFor: async () => presetKey,
    })
    h.ctx.services.set('tools', {
      schemas: (scope?: unknown) =>
        scope === undefined
          ? [{ name: 'wf_run_node', description: 'Start a node.' }]
          : scope === presetKey
            ? [{ name: 'read', description: 'Read a file.' }, { name: 'mcp__demo__fetch', description: 'Fetch.' }]
            : [],
    })
    const catalog = (await h.api.handle('pluginCatalog', {})) as {
      items: Array<{ key: string; name: string; description: string; source: string }>
      mcp: Array<{ id: string }>
    }
    const names = catalog.items.map((item) => item.name).sort()
    expect(names).toEqual(['mcp__demo__fetch', 'read', 'wf_run_node'])
    const read = catalog.items.find((item) => item.name === 'read')
    expect(read?.description).toContain('读取文件')
    expect(catalog.mcp[0]).toMatchObject({ id: 'mcp-demo' })
  })
})

// ---------------------------------------------------------------------------
// 运行端点
// ---------------------------------------------------------------------------

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

  it('activeRuns：会话当前活跃 run 列表（running/paused 保留锁；用于进入工作台自动选中实例）', async () => {
    const h = await makeHarness()
    await saveFlow(h)
    await h.api.handle('run', { sessionId: 'session-1', flowId: 'flow-1' })
    // running 中：应返回该 flowId
    const runningRuns = (await h.api.handle('activeRuns', { sessionId: 'session-1' })) as Array<{ flowId: string; status: string; runId: string }>
    expect(runningRuns).toHaveLength(1)
    expect(runningRuns[0]).toMatchObject({ flowId: 'flow-1', status: 'running', runId: 'run-1' })

    // 无 sessionId → 400
    await expect(h.api.handle('activeRuns', {})).rejects.toMatchObject({ status: 400 })

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
// 导入导出
// ---------------------------------------------------------------------------

describe('导入导出', () => {
  it('exportWorkflow → importWorkflow：冲突/rename/overwrite（图2 改造：导入落为模板）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })

    const { json } = (await h.api.handle('exportWorkflow', { sessionId: 'session-1', id: 'flow-1' })) as { json: string }
    const bundle = JSON.parse(json) as { format?: string; version?: number; workflow?: { name?: string } }
    expect(bundle.format).toBe('dsh-vw-bundle')
    expect(bundle.version).toBe(2)

    // 首次导入：模板库为空 → 直接创建模板（不落实例）
    const first = (await h.api.handle('importWorkflow', { json })) as { template?: { id?: string; name?: string } }
    expect(first.template?.name).toBe('测试流程')
    expect((await h.store.listWorkflows('session-1')).length).toBe(1) // 实例数不变
    expect((await h.store.listFlowTemplates()).length).toBe(1)

    // 二次导入同名单 → conflict（模板库重名判定）
    const conflict = (await h.api.handle('importWorkflow', { json })) as { conflict?: boolean }
    expect(conflict.conflict).toBe(true)

    // rename → 新名称模板
    const renamed = (await h.api.handle('importWorkflow', { json, conflictMode: 'rename' })) as {
      template?: { id?: string; name?: string }
    }
    expect(renamed.template?.name).toBe('测试流程 (2)')
    expect((await h.store.listWorkflows('session-1')).length).toBe(1) // 实例数不变
    expect((await h.store.listFlowTemplates()).length).toBe(2)

    // overwrite → 覆盖同名模板（'测试流程'；数量不变，id 保持为首个模板 id）
    const firstId = first.template?.id
    const overwritten = (await h.api.handle('importWorkflow', { json, conflictMode: 'overwrite' })) as {
      template?: { id?: string }
    }
    expect(overwritten.template?.id).toBe(firstId)
    expect((await h.store.listFlowTemplates()).length).toBe(2)
  })

  it('模式二服务导出/导入往返（service 字段、落到模板库、冲突语义）', async () => {
    const h = await makeHarness()
    const service = {
      id: 'svc-1',
      sessionId: 'session-1',
      mode: 'mode2',
      name: '示例服务',
      description: '服务描述',
      revision: 0,
      status: 'stopped',
      nodes: [agent('n-a', '子'), stage('n-start', 'start'), stage('n-end', 'end')],
      lines: [],
    } as never
    await h.store.saveService(service, 'session-1', { force: true })

    const { json } = (await h.api.handle('exportWorkflow', { sessionId: 'session-1', id: 'svc-1' })) as { json: string }
    const bundle = JSON.parse(json) as { format?: string; mode?: string; service?: { name?: string } }
    expect(bundle.format).toBe('dsh-vw-bundle')
    expect(bundle.mode).toBe('mode2')
    expect(bundle.service?.name).toBe('示例服务')

    // 首次导入 → mode2 模板（模板库为空不 conflict）
    const first = (await h.api.handle('importWorkflow', { json })) as { template?: { id?: string; name?: string; mode?: string } }
    expect(first.template?.name).toBe('示例服务')
    expect(first.template?.mode).toBe('mode2')
    expect((await h.store.listServices('session-1')).length).toBe(1) // 服务实例不变
    expect((await h.store.listFlowTemplates()).length).toBe(1)

    // 同名单 → conflict；rename → 新名称 mode2 模板
    const conflict = (await h.api.handle('importWorkflow', { json })) as { conflict?: boolean }
    expect(conflict.conflict).toBe(true)
    const renamed = (await h.api.handle('importWorkflow', { json, conflictMode: 'rename' })) as { template?: { id?: string; name?: string; mode?: string } }
    expect(renamed.template?.name).toBe('示例服务 (2)')
    expect(renamed.template?.mode).toBe('mode2')
    expect((await h.store.listServices('session-1')).length).toBe(1)
    expect((await h.store.listFlowTemplates()).length).toBe(2)
  })

  it('角色模板导出/导入往返；非法文件 400/422', async () => {
    const h = await makeHarness()
    await h.api.handle('putTemplate', {
      kind: 'role',
      template: { id: 'role-1', kind: 'agent', name: '研究员', systemPrompt: 'x', provider: '', model: '', presetId: 'standard', retryLimit: 3 },
    })
    const { json } = (await h.api.handle('exportAgentTemplate', { id: 'role-1' })) as { json: string }
    // 同名已存在 → conflict；overwrite → 成功往返
    const conflict = await h.api.handle('importAgentTemplate', { json })
    expect(conflict).toMatchObject({ conflict: true })
    const imported = (await h.api.handle('importAgentTemplate', { json, conflictMode: 'overwrite' })) as { template?: { id?: string } }
    expect(imported.template?.id).toBe('role-1')

    await expect(h.api.handle('importWorkflow', { sessionId: 'session-1', json: 'not-json' })).rejects.toMatchObject({ status: 400 })
    await expect(h.api.handle('importWorkflow', { sessionId: 'session-1', json: JSON.stringify({ format: 'x' }) })).rejects.toMatchObject({
      status: 422,
    })
  })

  it('Bug 16：导出 bundle 携带 roles/files/databases 模板；导入重建模板库', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await h.api.handle('putTemplate', {
      kind: 'role',
      template: { id: 'role-1', kind: 'agent', name: '研究员', systemPrompt: 'x', provider: '', model: '', presetId: 'standard', retryLimit: 3 },
    })
    await h.api.handle('putTemplate', {
      kind: 'file',
      template: { id: 'file-1', name: '资料.pdf', fileKind: 'file', managedPath: 'data/files/x.pdf', fileName: '资料.pdf' },
    })
    await h.api.handle('putTemplate', {
      kind: 'database',
      template: { id: 'db-1', name: '本地库', description: 'd', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/x.db' },
    })

    const { json } = (await h.api.handle('exportWorkflow', { sessionId: 'session-1', id: 'flow-1' })) as { json: string }
    const bundle = JSON.parse(json) as {
      embedded?: { roles?: Array<{ id?: string }>; files?: Array<{ id?: string }>; databases?: Array<{ id?: string }> }
    }
    // 导出必须包含三类模板（架构文档 §6.4 embedded 逐字段）
    expect(bundle.embedded?.roles?.map((t) => t.id)).toEqual(['role-1'])
    expect(bundle.embedded?.files?.map((t) => t.id)).toEqual(['file-1'])
    expect(bundle.embedded?.databases?.map((t) => t.id)).toEqual(['db-1'])

    // 导入到另一会话：模板全局共享 → 落库可复用
    await h.api.handle('importWorkflow', { sessionId: 'session-2', json, conflictMode: 'rename' })
    const roles = await h.store.listTemplates('role')
    expect(roles.some((t) => t.name === '研究员')).toBe(true)
    const files = await h.store.listTemplates('file')
    expect(files.some((t) => t.name === '资料.pdf')).toBe(true)
    const dbs = await h.store.listTemplates('database')
    expect(dbs.some((t) => t.name === '本地库')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MCP 端点
// ---------------------------------------------------------------------------

describe('MCP 端点', () => {
  it('mcpPut/mcpList/mcpToggle/mcpDelete：托管区读写往返', async () => {
    const h = await makeHarness()
    const mcpDir = join(h.dataDir, 'dsh-home')
    process.env.DSH_HOME = mcpDir
    const patch = join(mcpDir, 'profiles', 'web', 'cordis.patch.yml')

    const saved = (await h.api.handle('mcpPut', {
      server: { id: 'mcp-demo', serverName: 'demo', transport: 'stdio', command: 'npx -y demo-server', args: ['--port', '9000'] },
    })) as { id?: string; serverName?: string; command?: string; args?: string[] }
    expect(saved.id).toBe('mcp-demo')
    expect(saved.command).toBe('npx')
    expect(saved.args).toEqual(['-y', 'demo-server', '--port', '9000'])

    const list = (await h.api.handle('mcpList', {})) as Array<{ id?: string }>
    expect(list).toHaveLength(1)

    // 托管区已写入 profile（YAML 单引号标量：反斜杠/路径字面量，避免双重转义事故）
    const text = await readFile(patch, 'utf8')
    expect(text).toContain('# >>> dsh-visual-workflow')
    expect(text).toContain("serverName: 'demo'")

    await h.api.handle('mcpToggle', { id: 'mcp-demo', disabled: true })
    const toggled = (await h.api.handle('mcpList', {})) as Array<{ disabled?: boolean }>
    expect(toggled[0].disabled).toBe(true)

    const removed = await h.api.handle('mcpDelete', { id: 'mcp-demo' })
    expect(removed).toEqual({ deleted: true })
    expect(await h.api.handle('mcpList', {})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 路由注册与受管文件下载
// ---------------------------------------------------------------------------

describe('路由注册与下载', () => {
  it('registerRoutes：注册/注销、非 POST 405、无效 JSON 400、错误映射', async () => {
    const h = await makeHarness()
    let registered: { kind?: string; path?: string; handler?: (req: unknown, res: unknown) => Promise<void> } | null = null
    const fakeWebServer = {
      register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {
          registered = null
        }
      },
    }
    h.ctx.services.set('webServer', fakeWebServer)
    const dispose = registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
    expect(registered).toMatchObject({ kind: 'prefix', path: '/visual-workflow' })

    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      end(body: string) {
        responses[responses.length - 1].body = String(body ?? '')
        return this
      },
    }
    /** 构造流式 req（data 触发一次 body、end 收尾；无 body 时仅 end）。 */
    const reqOf = (method: string, url: string, body?: string) => ({
      method,
      url,
      on(event: string, cb: (chunk?: unknown) => void) {
        if (event === 'data' && body !== undefined) cb(body)
        if (event === 'end') cb()
      },
      destroy() {},
    })

    // 非 POST → 405
    await registered!.handler!(reqOf('GET', '/visual-workflow/listWorkflows'), res)
    expect(responses[0].status).toBe(405)

    // 无效 JSON → 400
    await registered!.handler!(reqOf('POST', '/visual-workflow/toolCombos', '{bad json'), res)
    expect(responses[1].status).toBe(400)

    // 正常端点（带 body）
    await registered!.handler!(reqOf('POST', '/visual-workflow/toolCombos', '{"args":{}}'), res)
    expect(responses[2].status).toBe(200)
    expect(JSON.parse(responses[2].body)).toMatchObject({ ok: true })

    // 未知端点 → 404
    await registered!.handler!(reqOf('POST', '/visual-workflow/nope'), res)
    expect(responses[3].status).toBe(404)

    // 错误响应携带稳定 code（Bug 20）：revision 冲突 → 409 + code 字段
    const conflictFlow = { id: 'flow-code-1', sessionId: 'session-1', mode: 'mode1', name: 'c', description: '', revision: 0, nodes: [], lines: [] }
    await registered!.handler!(reqOf('POST', '/visual-workflow/putWorkflow', JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })), res)
    expect(responses[4].status).toBe(200)
    await registered!.handler!(reqOf('POST', '/visual-workflow/putWorkflow', JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })), res)
    expect(responses[5].status).toBe(409)
    expect(JSON.parse(responses[5].body)).toMatchObject({ ok: false, error: { message: expect.any(String), code: 'FLOW_REVISION_CONFLICT' } })

    // disposer 生效
    dispose()
    expect(registered).toBeNull()
  })

  it('受管拷贝与下载路由：GET 返回内容、目录穿越拒绝、405', async () => {
    const h = await makeHarness()
    const copied = await copyIntoManagedFile(h.dataDir, { name: 'doc.txt', base64: Buffer.from('受管内容').toString('base64') })
    expect(copied.fileName).toBe('doc.txt')
    const bytes = await readFile(managedFilePath(h.dataDir, 'doc.txt'), 'utf8')
    expect(bytes).toBe('受管内容')

    let registered: { handler: (req: unknown, res: unknown) => Promise<void> } | null = null
    h.ctx.services.set('webServer', {
      register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {}
      },
    })
    registerDownloadRoute({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.dataDir)
    expect(registered).toMatchObject({ handler: expect.any(Function) })

    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      end(body: string) {
        responses[responses.length - 1].body = String(body ?? '')
        return this
      },
    }
    await registered!.handler({ method: 'GET', url: '/visual-workflow/files/doc.txt' }, res)
    expect(responses[0].status).toBe(200)
    expect(responses[0].body).toBe('受管内容')

    await registered!.handler({ method: 'GET', url: '/visual-workflow/files/..%2Fsecret' }, res)
    expect(responses[1].status).toBe(404)

    await registered!.handler({ method: 'POST', url: '/visual-workflow/files/doc.txt' }, res)
    expect(responses[2].status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// 服务调试流式代理（serviceDebug：运行中服务 → SSE 透传）
// ---------------------------------------------------------------------------

describe('服务调试流式代理（serviceDebug）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 构造上游 SSE 响应体（逐块下发）。 */
  function sseStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    })
  }

  /** fake res（记录写头与 SSE 块）。 */
  function makeSseRes() {
    const chunks: string[] = []
    let head: { status: number; headers: Record<string, string> } | null = null
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        head = { status, headers }
      },
      write(chunk: string) {
        chunks.push(String(chunk))
      },
      end(body?: string) {
        if (body) chunks.push(String(body))
      },
    }
    return { res, chunks, head: () => head }
  }

  /** 注册路由并返回 handler。 */
  async function registeredHandler(h: Harness): Promise<(req: unknown, res: unknown) => Promise<void>> {
    let registered: { handler: (req: unknown, res: unknown) => Promise<void> } | null = null
    h.ctx.services.set('webServer', {
      register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {}
      },
    })
    registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
    return registered!.handler
  }

  const reqOf = (args: Record<string, unknown>) => ({
    method: 'POST',
    url: '/visual-workflow/serviceDebug',
    on(event: string, cb: (chunk?: unknown) => void) {
      if (event === 'data') cb(JSON.stringify({ args }))
      if (event === 'end') cb()
    },
    destroy() {},
  })

  it('运行中服务：SSE 逐块透传 + 调试 userId 隔离 + 默认无鉴权头', async () => {
    const h = await makeHarness()
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'running', port: 7877 }),
    } as never
    const fetchMock = vi.fn(async () => new Response(sseStream([
      'data: {"delta":{"content":"你好"}}\n\n',
      'data: [DONE]\n\n',
    ]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await registeredHandler(h)
    const { res, chunks, head } = makeSseRes()

    await handler(reqOf({ serviceId: 'svc-1', sessionId: 'session-9', prompt: '测试问题' }), res)

    expect(head()?.status).toBe(200)
    expect(head()?.headers['Content-Type']).toContain('text/event-stream')
    const joined = chunks.join('')
    expect(joined).toContain('data: {"delta":{"content":"你好"}}\n\n')
    expect(joined).toContain('data: [DONE]\n\n')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:7877/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.user_id).toBe('debug-session-9')
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([{ role: 'user', content: '测试问题' }])
    expect((init.headers as Record<string, string>)?.Authorization).toBeUndefined()
  })

  it('apiKey 已配置：转发携带 Bearer 鉴权头（密钥不落浏览器）', async () => {
    const h = await makeHarness()
    h.host.apiKey = 'sk-secret'
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'running', port: 7877 }),
    } as never
    const fetchMock = vi.fn(async () => new Response(sseStream(['data: [DONE]\n\n']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await registeredHandler(h)
    await handler(reqOf({ serviceId: 'svc-1', sessionId: 'session-9', prompt: 'hi' }), makeSseRes().res)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-secret')
  })

  it('服务未运行 → 409 WF_SERVICE_NOT_RUNNING（JSON 错误，未写流头）', async () => {
    const h = await makeHarness()
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'stopped' }),
    } as never
    const handler = await registeredHandler(h)
    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      write(chunk: string) {
        responses[responses.length - 1].body += String(chunk)
      },
      end(body?: string) {
        responses[responses.length - 1].body += String(body ?? '')
        return this
      },
    }
    await handler(reqOf({ serviceId: 'svc-1', sessionId: 'session-9', prompt: 'hi' }), res)
    expect(responses[0].status).toBe(409)
    expect(JSON.parse(responses[0].body)).toMatchObject({ ok: false, error: { message: expect.stringContaining('未运行') } })
  })

  it('参数缺失 → 400；上游 401 → 状态透传（JSON）', async () => {
    const h = await makeHarness()
    h.host.serviceManager = {
      status: async () => ({ serviceId: 'svc-1', status: 'running', port: 7877 }),
    } as never
    const handler = await registeredHandler(h)
    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      write(chunk: string) {
        responses[responses.length - 1].body += String(chunk)
      },
      end(body?: string) {
        responses[responses.length - 1].body += String(body ?? '')
        return this
      },
    }
    await handler(reqOf({ serviceId: 'svc-1' }), res)
    expect(responses[0].status).toBe(400)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"API Key 无效"}}', { status: 401 })))
    await handler(reqOf({ serviceId: 'svc-1', sessionId: 's', prompt: 'hi' }), res)
    expect(responses[1].status).toBe(401)
    expect(JSON.parse(responses[1].body)).toMatchObject({ ok: false, error: { message: 'API Key 无效' } })
  })
})
