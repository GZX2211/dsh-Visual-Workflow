// tests/host/api/fixtures/api-harness.ts
//
// GUI API 边界测试共享夹具：真实 FlowStore（临时目录）+ fake 编排运行时与 fake 生态服务，
// 以及各端点组共用的图文档构造器。
//
// 资源回收约定：夹具创建的资源登记在 `cleanups`，使用方在测试文件内 `afterEach(cleanupAll)`；
// 使用 DSH_HOME 的用例另用 `snapshotDshHome()` 保存/恢复环境变量。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../../../src/host/orchestrator/index.js'
import { VisualWorkflowApi, type ApiHost } from '../../../../src/host/api/index.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import type { DatabaseNode, RoleNode, StageNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import type { EmbeddingEngine } from '../../../../src/host/embedding/engine.js'

/** 待回收资源（测试文件 afterEach 经 cleanupAll 回收）。 */
export const cleanups: Array<() => Promise<void>> = []

/** 回收全部登记资源（可重复调用）。 */
export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
}

/** 保存当前 DSH_HOME 并返回恢复函数（MCP 托管区/插件目录用例共用）。 */
export function snapshotDshHome(): () => void {
  const saved = process.env.DSH_HOME
  return () => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
}

export function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

export function agent(id: string, label: string): RoleNode {
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

export function makeFlow(): WorkflowDocument {
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

export function databaseNode(id: string, localPath: string): DatabaseNode {
  return {
    id,
    kind: 'database',
    position: { x: 0, y: 0 },
    data: { label: '本地库', description: '', dbType: 'local', dbKind: 'sqlite', localPath },
  }
}

export class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  messages: RootInjectedMessage[] = []
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

export class FakeAgents implements AgentHost {
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

export class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    return { childId: `child-${this.calls.length}`, created: true }
  }
  async interruptChild(): Promise<void> {}
}

/** 端点测试上下文（fake 生态服务可注入）。 */
export interface CtxLike {
  get(name: string): unknown
}

export class FakeCtx implements CtxLike {
  services = new Map<string, unknown>()
  get(name: string): unknown {
    return this.services.get(name)
  }
}

export interface Harness {
  api: VisualWorkflowApi
  host: ApiHost
  runtime: OrchestratorRuntime
  store: FlowStore
  ctx: FakeCtx
  dataDir: string
}

/** 构造端点测试夹具（真实 store + fake 运行时/宿主能力）。 */
export async function makeHarness(config?: Partial<OrchestratorConfig>): Promise<Harness> {
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
export async function saveFlow(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
}
