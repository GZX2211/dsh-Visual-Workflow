// src/host/orchestrator/run-entry.ts
//
// 单次运行的内存条目（RunEntry）与阻塞等待器，以及运行对外接口契约：
//   - RunEntry：单次运行的内存条目（快照 + 护栏计数 + in-flight 表）；
//   - Waiter / createWaiter：wait:true 阻塞等待器的创建；
//   - OrchestratorDeps：编排器依赖装配（数据层/子代理引擎/父代理宿主/提示词与
//     模型装配/配置/日志/时钟与 id 生成注入/外部能力缝）；
//   - 工具与启动/收尾的入出参接口（RunNodeArgs/RunNodeResult/StartRunOptions 等）。

import type { FlowStore } from '../storage/flow-store.js'
import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot, RunStatus } from '../shared/types.js'
import type {
  AgentHost,
  NodeRunner,
  OrchestratorConfig,
  OrchestratorLogger,
  ParentModelSelectionLike,
  ParentPromptSetupLike,
} from './seams.js'
import type { PendingAsk } from './ask-protocol.js'

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
  /**
   * 执行者模式：父代理节点 id（父代理被流程线连接，作为执行单元先执行自身任务）。
   * 启动时登记；父代理开始调度（首次 wf_run_node/wf_finish）时把该节点标记 ok。
   */
  executorParentId?: string
  /**
   * 执行者模式：本轮父代理执行单元是否为**里程碑闸门**（proxy.data.role='milestone'）。
   * true 时 `markParentExecutorDone` 不生效——闸门只能由 wf_graph_patch(mark_node) 显式
   * 标记完成（D-07）。内存态：startRun/resumeRun 时按当前画布重新推导。
   */
  executorIsMilestone?: boolean
  /** 当前闸门虚拟节点 id（executorIsMilestone 时给出；mark_node 接受它或父代理节点 id）。 */
  milestoneProxyId?: string
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
  promptSetup?: ParentPromptSetupLike
  /** 模型选择装配（父代理模型/思考强度注入；缺省跳过父代理绑定）。 */
  modelSelection?: ParentModelSelectionLike
  /**
   * 父代理角色 Prompt 读取能力（宿主注入：agent 层实现，含 .md 路径设置时的文件读取）。
   * 为什么经缝注入：读角色 Prompt 文件属 agent 关注点，编排器只做「注入到根 Agent ctx」。
   */
  resolveRolePrompt?: (node: RoleNode) => Promise<string>
  /** 配置子集。 */
  config: OrchestratorConfig
  /**
   * 运行期数据库索引预建能力（宿主注入；缺省跳过预建，交由 wf_db_query(mode=search)
   * 的惰性构建兜底）。用于在启动节点子代理之前为其 db-in 所连库预建索引，
   * 吸收构建耗时、避免子代理首次检索才构建。
   * 为什么注入能力而非具体实现：具体索引服务属数据工具域，编排器不反向依赖 tools。
   */
  dbIndexer?: { ensureIndexes(nodeId: string, flow: WorkflowDocument): Promise<void> }
  /** 系统语言名读取（宿主注入：从 DSH 用户设置读取；缺省回退默认语言）。 */
  systemLanguage?: () => string
  /** 日志（缺省 console）。 */
  logger?: OrchestratorLogger
  /** 时钟注入（单测可控；缺省 Date.now）。 */
  now?: () => number
  /** runId 生成注入（缺省 run-<base36 时间戳>-<随机段>）。 */
  newRunId?: () => string
  /** 消息 id 生成注入（缺省 randomUUID）。 */
  uuid?: () => string
}

/**
 * 闸门标记所需的运行事实（只读；wf_graph_patch 的 mark_node 路径消费）。
 * 快照归编排器所有，工具层据此裁决预算与目标合法性，不再直读 RunEntry/snapshot。
 */
export interface MilestoneRunFacts {
  runId: string
  executorParentId: string
  executorIsMilestone: boolean
  milestoneProxyId?: string
  nodeIds: string[]
  milestoneUsed: number
  milestoneMax: number
}

/** 闸门节点标记结果（markMilestoneNode 返回；milestoneUsed 为递增后的已用次数）。 */
export interface MilestoneMarkResult {
  nodeId: string
  status: 'ok' | 'fail'
  runId: string
  milestoneUsed: number
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
  /** 实际执行会话 id（工作台全局化改版：恒等于入参 sessionId——运行只认实例绑定的会话）。 */
  sessionId: string
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
