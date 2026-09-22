// tests/host/tools/fixtures/tool-harness.ts
//
// wf_* / wf_db_query 工具测试的共用装配骨架（非测试文件，vitest 不收集）：
//   - 真实 OrchestratorRuntime + 临时 FlowStore（真实协作，不以 Mock 替代被测对象）；
//   - fake 宿主缝：agents / runner / tools 注册表 / userQuestions；
//   - 固定时钟与确定性 id（时间、随机、异步可确定）；
//   - 临时目录统一登记，测试文件在 afterEach 调 cleanupTempDirs()。

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
  type TurnEndInfo,
} from '../../../../src/host/orchestrator/index.js'
import { stageLabel } from '../../../../src/host/graph/model.js'
import type { RoleNode, StageNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import type { ToolDefinitionLike, ToolExecLike } from '../../../../src/host/tools/infrastructure/define-tool.js'

// ---------------------------------------------------------------------------
// 临时目录
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = []

/** 创建临时目录（测试结束由 cleanupTempDirs 统一清理）。 */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 清理本文件登记的全部临时目录（测试文件 afterEach 调用）。 */
export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
}

// ---------------------------------------------------------------------------
// 流程构造
// ---------------------------------------------------------------------------

export function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

export function role(id: string, kind: 'agent' | 'parent', label: string): RoleNode {
  return {
    id,
    kind,
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

/** 标准测试流程（模式一）：start → a1 → pause → a2 → end。 */
export function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), role('n-a1', 'agent', '子任务A'), stage('n-pause', 'pause'), role('n-a2', 'agent', '子任务B'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

export class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
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
  followupRoot(): void {}
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

/** fake tools 注册表：收集定义与注销调用。 */
export class FakeToolsRegistry {
  definitions = new Map<string, ToolDefinitionLike>()
  unregistered = new Set<string>()
  register(def: ToolDefinitionLike): () => void {
    if (this.definitions.has(def.name)) throw new Error(`duplicate tool: ${def.name}`)
    this.definitions.set(def.name, def)
    return () => {
      this.unregistered.add(def.name)
      this.definitions.delete(def.name)
    }
  }
}

/** fake userQuestions 服务。 */
export class FakeUserQuestions {
  calls: Array<{ questions: unknown[]; agent: unknown; signal?: AbortSignal }> = []
  answer = { answers: [{ id: 'q1', selected: ['是'], custom: '' }] }
  fail: unknown = null
  async ask(request: { questions: unknown[]; agent?: unknown; signal?: AbortSignal }): Promise<{ answers?: unknown[] }> {
    this.calls.push({ questions: request.questions, agent: request.agent, signal: request.signal })
    if (this.fail !== null) {
      const error = this.fail
      this.fail = null
      throw error
    }
    return this.answer
  }
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

/** 工具 ctx 最小形状（ctx.get 按名取服务）。 */
export interface ToolCtxLike {
  get(name: string): unknown
}

export interface TestEnv {
  dir: string
  store: FlowStore
  runtime: OrchestratorRuntime
  agents: FakeAgents
  runner: FakeRunner
  tools: FakeToolsRegistry
  questions: FakeUserQuestions
  clock: { now: number }
}

/** 装配：临时 dataDir + 真实编排运行时 + fake 依赖（工具注册由各测试文件自行完成）。 */
export async function makeEnv(options: { config?: Partial<OrchestratorConfig> } = {}): Promise<TestEnv> {
  const dir = await tempDir('vw-tools-')
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runner = new FakeRunner()
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
      ...options.config,
    },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    now: () => clock.now,
    newRunId: () => `run-${clock.now}`,
    uuid: () => `uuid-${clock.now}`,
  })
  return { dir, store, runtime, agents, runner, tools: new FakeToolsRegistry(), questions: new FakeUserQuestions(), clock }
}

/** 构造工具 ctx（默认含 tools 与 userQuestions；`userQuestions: false` 用于缺服务用例）。 */
export function ctxOf(env: TestEnv, options: { userQuestions?: boolean } = {}): ToolCtxLike {
  const withQuestions = options.userQuestions !== false
  return {
    get: (name: string) =>
      name === 'tools' ? env.tools : withQuestions && name === 'userQuestions' ? env.questions : null,
  }
}

/** 注册一组工具；返回聚合 disposer（逐个注销，注销失败向上抛出以便测试暴露问题）。 */
export function registerTools<H>(
  env: TestEnv,
  host: H,
  registrars: Array<(ctx: ToolCtxLike, host: H) => () => void>,
  options: { userQuestions?: boolean } = {},
): () => void {
  const ctx = ctxOf(env, options)
  const disposers = registrars.map((register) => register(ctx, host))
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** 构造工具执行上下文（agent 形状按官方 Session header 事实）。 */
export function execOf(agent: unknown, signal?: AbortSignal): ToolExecLike {
  return { signal: signal ?? new AbortController().signal, agent }
}

export const rootAgent = { id: 'session-1', session: { header: {} } }
export const childAgent = {
  id: 'child-1',
  session: { header: { origin: 'subagent', parentSession: 'session-1' } },
}

/** 保存流程并 startRun。 */
export async function start(env: TestEnv): Promise<void> {
  await env.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
  await env.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
}

/** 保存并启动一个模式二后台服务流程（仅 start → a1 → end，无暂停节点）。 */
export async function startService(env: TestEnv): Promise<void> {
  const flow = makeFlow()
  flow.mode = 'mode2'
  flow.name = '测试服务'
  flow.nodes = [
    role('n-parent', 'parent', '父代理'),
    ...flow.nodes
      .filter((n) => n.kind !== 'pause')
      .map((n) => (n.kind === 'start' || n.kind === 'end'
        ? { ...n, data: { ...n.data, label: stageLabel(n.kind, 'mode2') } }
        : n)),
  ]
  flow.lines = flow.lines.filter((line) => line.source !== 'n-pause' && line.target !== 'n-pause')
  await env.store.saveService(flow as never, 'session-1', { force: true })
  await env.runtime.startRun({ sessionId: 'session-1', flowId: flow.id, mode: 'mode2' })
}
