// src/host/orchestrator/run-types.ts
//
// 运行时的内存状态类型与 wf_run_node / 编排启动收尾的入出参类型：
//   - RunEntry：单次运行的内存条目（快照 + 护栏计数 + in-flight 表）；
//   - Waiter / createWaiter：wait:true 阻塞等待器的创建；
//   - OrchestratorDeps：编排器依赖装配（数据层/子代理引擎/父代理宿主/提示词与
//     模型装配/配置/日志/时钟与 id 生成注入）；
//   - 工具与启动/收尾的入出参接口（RunNodeArgs/RunNodeResult/StartRunOptions 等）。

import type { FlowStore } from '../storage/flow-store.js'
import type { WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot, RunStatus } from '../shared/types.js'
import type { ChildPromptSetup } from '../agent/prompt-setup.js'
import type { ModelSelectionSetup } from '../agent/model-selection.js'
import type { EmbeddingEngine } from '../embedding/engine.js'
import type { AgentHost, NodeRunner, OrchestratorConfig, OrchestratorLogger } from './seams.js'
import type { AskAgentResult, PendingAsk } from './ask-types.js'

/** 单次运行的内存条目（旧项目 entry 同构：快照 + 护栏计数 + in-flight 表）。 */
export interface RunEntry {
  /** 运行级取消控制器（停止/终止/插件卸载时 abort；阻塞中的 wait/提问随之取消）。 */
  controller: AbortController
  /** 运行快照（状态机事实源；持久化副本经 store.saveRun）。 */
  snapshot: RunSnapshot
  /** 起始工作流（currentResolvedFlow 读失败时的回退）。 */
  baseFlow: WorkflowDocument
  /** 运行中的子代理 childId 集合（空闲看护据此不判空闲）。 */
  inflight: Set<string>
  /** nodeId → 已调用次数（回流重试硬护栏）。 */
  attempts: Map<string, number>
  /** wf_run_node 总调用数（全局硬护栏）。 */
  callCount: number
  /** 最近活动时间戳（空闲看护基准）。 */
  lastActiveAt: number
  /** 阻塞等待表：`${runId}:${nodeId}` → waiter（wait:true 路径）。 */
  waiters: Map<string, Waiter>
  /** 挂起协作通信表：askId → PendingAsk（wf_ask_agent 路径）。 */
  asks: Map<string, PendingAsk>
}

/** wait:true 的阻塞等待器（subagent/end 唤醒 resolve；终止/取消 reject）。 */
export interface Waiter {
  promise: Promise<RunNodeResult>
  resolve: (result: RunNodeResult) => void
  reject: (error: unknown) => void
}

/** 创建挂起等待器（resolve/reject 闭合到 promise）。 */
export function createWaiter(): Waiter {
  let resolve!: (result: RunNodeResult) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<RunNodeResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** wf_run_node 入参（工具参数经 schema 校验后传入；未知字段宽松处理）。 */
export interface RunNodeArgs {
  nodeId?: unknown
  wait?: unknown
  thinking?: unknown
  iterationLimit?: unknown
  retryLimit?: unknown
}

/** wf_run_node 返回（三条路径：started 异步 / paused 暂停门 / ok|fail wait 阻塞）。 */
export interface RunNodeResult {
  nodeId: string
  status: 'started' | 'paused' | 'ok' | 'fail'
  childId?: string
  output?: string
}

/** 官方 subagent/end 观察 payload（全字段可选，运行时守卫）。 */
export interface SubagentEndInfo {
  runId?: unknown
  provider?: unknown
  id?: unknown
  local?: unknown
  stopReason?: unknown
  lastAssistantMessage?: unknown
}

/** 编排器全部依赖（单测 fake / index.ts 真实适配）。 */
export interface OrchestratorDeps {
  /** 数据层（FlowStore）。 */
  store: FlowStore
  /** 节点子代理执行引擎（单测 fake）。 */
  runner: NodeRunner
  /** 父代理宿主能力（index.ts 的 CordisAgentHost；单测 fake）。 */
  agents: AgentHost
  /** 子代理/父代理提示词注入装配（角色 Prompt 段 + 官方系统提示词开关；缺省跳过父代理绑定）。 */
  promptSetup?: ChildPromptSetup
  /** 模型选择装配（父代理模型/思考强度注入；缺省跳过父代理绑定）。 */
  modelSelection?: ModelSelectionSetup
  /** 配置子集。 */
  config: OrchestratorConfig
  /**
   * 运行期数据库索引预建能力（宿主注入；缺省跳过预建，交由 wf_db_query(mode=search)
   * 的惰性构建兜底）。用于在启动节点子代理之前为其 db-in 所连本地库预建索引，
   * 吸收构建耗时、避免子代理首次检索才构建。
   */
  dbIndexer?: { dataDir: string; engine: EmbeddingEngine }
  /** 日志（缺省 console）。 */
  logger?: OrchestratorLogger
  /** 时钟注入（单测可控；缺省 Date.now）。 */
  now?: () => number
  /** runId 生成注入（缺省 run-<base36 时间戳>-<随机段>）。 */
  newRunId?: () => string
  /** 消息 id 生成注入（缺省 randomUUID）。 */
  uuid?: () => string
}

export interface StartRunOptions {
  /** 运行模式（缺省 mode1；模式二由服务管理器传入 mode2）。 */
  mode?: 'mode1' | 'mode2'
  /** 模式二：本次外部请求的用户问题（注入输入节点产出 + 编排指令动态段）。 */
  question?: string
}

export interface StartRunResult {
  runId: string
  /** 流程事实源文件绝对路径（编排指令 facts.definitionPath）。 */
  defPath: string
}

export interface FinishArgs {
  status?: unknown
  summary?: unknown
}

export interface FinishResult {
  ok: true
  runId: string
  status: RunStatus
  /** 已终止运行的幂等收尾标记。 */
  idempotent?: boolean
}

export interface TerminateOptions {
  status: 'stopped' | 'failed'
  summary: string
  abortReason?: string
}
