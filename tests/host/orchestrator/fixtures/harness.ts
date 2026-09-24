// tests/host/orchestrator/fixtures/harness.ts
//
// 编排运行时单测的共用装配（非测试文件，vitest 不收集）：
//   - 图构造器（stage/agent/fileNode/parentNode/makeFlow）；
//   - fake 依赖缝（FakeRoot/FakeAgents/FakeRunner）与真实 FlowStore 装配（makeHarness）；
//   - 临时目录统一登记，测试文件在 afterEach 调 cleanupTempDirs()；
//   - 固定时钟与确定性 id（时间、随机、异步可确定）。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  lastAssistantText,
  type AgentHost,
  type CallerInfo,
  type CoordinatorMessage,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../../../src/host/orchestrator/index.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import type { FileNode, RoleNode, StageNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 测试替身与装配
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = []

/** 清理本文件登记的全部临时目录（测试文件 afterEach 调用）。 */
export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
}


/** 阶段节点（固定 id，确定性测试）。 */
export function stage(id: string, kind: 'start' | 'end' | 'pause', mode: 'mode1' | 'mode2' = 'mode1'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, mode) } }
}

/** 角色节点（固定 id + 可覆盖数据）。 */
export function agent(id: string, label: string, extra: Partial<RoleNode['data']> = {}): RoleNode {
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
      ...extra,
    },
  }
}

/** 文件节点。 */
export function fileNode(id: string, label: string, extra: Partial<FileNode['data']> = {}): FileNode {
  return {
    id,
    kind: 'file',
    position: { x: 0, y: 0 },
    data: { label, fileKind: 'text', content: '', fileName: '', ...extra },
  }
}

/** 标准测试流程（模式一）：start → a1 → pause → a2 → end + a2 的虚拟节点。 */
export function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [
      stage('n-start', 'start', 'mode1'),
      agent('n-a1', '子任务A'),
      stage('n-pause', 'pause', 'mode1'),
      agent('n-a2', '子任务B'),
      stage('n-end', 'end', 'mode1'),
      { id: 'n-proxy-a2', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'n-a2' },
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 会话根 Agent fake。 */
export class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  messages: RootInjectedMessage[] = []
  /** steer 插队注入的消息（编排变更通知/协作超时通知等；父代理忙碌时走该通道）。 */
  steered: CoordinatorMessage[] = []
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
  steer(message: CoordinatorMessage): void {
    this.steered.push(message)
  }
}

/** AgentHost fake：available/根 Agent/注入/回合终态/子代理存活全部可控。 */
export class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  availableFlag = true
  turnEnd: TurnEndInfo | null = null
  runningChildren = new Set<string>()
  injectFail: unknown = null
  available(): boolean {
    return this.availableFlag
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    if (this.injectFail) throw this.injectFail
    ;(agent as FakeRoot).messages.push(message)
  }  latestTurnEnd(): TurnEndInfo | null {
    return this.turnEnd
  }
  /** 最近一条 assistant/message 文本（执行者模式回写用；沿官方事件扫描语义）。 */
  latestRootAssistantText(sessionId: string, afterMs: number): string | null {
    const root = this.roots.get(sessionId)
    if (!root) return null
    for (let index = root.session.events.length - 1; index >= 0; index -= 1) {
      const event = root.session.events[index] as { type?: unknown; time?: unknown; data?: { message?: { content?: unknown } } } | null
      if (!event || event.type !== 'assistant/message') continue
      if ((Number(event.time) || 0) < afterMs) continue
      const text = lastAssistantText(event.data?.message?.content, 0)
      if (text) return text
      return null
    }
    return null
  }
  childRunning(id: string): boolean {
    return this.runningChildren.has(id)
  }
}

/** NodeRunner fake：记录启动入参/中断调用；可注入失败与软截停标记。 */
export class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  interrupts: Array<{ childId: string; sessionId: string }> = []
  nextFail: unknown = null
  capped = new Set<string>()
  /**
   * 下一次 startNodeTask 上报被替换的旧 childId（模拟「配置签名变化 → 子代理重建」）。
   * 只在下一次调用生效（一次性），使测试能精确控制重建发生在第几次派发。
   */
  nextReplacedChildId: string | null = null
  private seq = 0
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean; replacedChildId?: string }> {
    this.calls.push(input)
    if (this.nextFail !== null) {
      const error = this.nextFail
      this.nextFail = null
      throw error instanceof Error ? error : new Error(String(error))
    }
    this.seq += 1
    const replaced = this.nextReplacedChildId
    this.nextReplacedChildId = null
    return replaced === null ? { childId: `child-${this.seq}`, created: true } : { childId: `child-${this.seq}`, created: true, replacedChildId: replaced }
  }
  async interruptChild(childId: string, sessionId: string): Promise<void> {
    this.interrupts.push({ childId, sessionId })
  }
  consumeReactCapped(childId: string): boolean {
    return this.capped.delete(childId)
  }
}

export interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  agents: FakeAgents
  runner: FakeRunner
  clock: { now: number }
  warnings: string[]
  /** 临时数据目录（直读磁盘落盘结果用）。 */
  dir: string
}

/** 装配：临时目录真实 FlowStore + fake 依赖 + 可控时钟与 id 生成。 */
export async function makeHarness(
  config?: Partial<OrchestratorConfig>,
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-orch-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const clock = { now: 1_000_000 }
  const runSeq = { n: 0 }
  const uuidSeq = { n: 0 }
  const warnings: string[] = []
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
      ...config,
    },
    logger: { warn: (message) => warnings.push(message), info: () => {}, debug: () => {} },
    now: () => clock.now,
    newRunId: () => {
      runSeq.n += 1
      return `run-${runSeq.n}`
    },
    uuid: () => {
      uuidSeq.n += 1
      return `uuid-${uuidSeq.n}`
    },
  })
  return { runtime, store, agents, runner, clock, warnings, dir }
}

export const caller: CallerInfo = { isChild: false, sessionId: 'session-1' }
export const childCaller: CallerInfo = { isChild: true, sessionId: 'session-1' }

/** 保存流程并 startRun；返回结果与内存 run entry。 */
export async function start(h: Harness, flow: WorkflowDocument) {
  await h.store.saveWorkflow(flow, 'session-1', { force: true })
  const result = await h.runtime.startRun({ sessionId: 'session-1', flowId: flow.id })
  const entry = h.runtime.activeRunForSession('session-1')
  if (!entry) throw new Error('startRun 后应有激活 run')
  return { result, entry }
}

/** 父代理节点（与 agent 同形状，仅 kind 不同）。 */
export function parentNode(id: string, label: string): RoleNode {
  return { ...agent(id, label), kind: 'parent' } as RoleNode
}
