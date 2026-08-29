// src/host/orchestrator/seams.ts
//
// 编排运行时的依赖缝（DI seams）与公共常量/错误：
//   - 常量：GLOBAL_RUN_CALL_LIMIT（全局调用上限）与 subagent/end 迟到缓冲参数；
//   - WfError：稳定 code 的编排错误（工具层转 isError 工具结果/测试断言共用）；
//   - 依赖缝接口：NodeRunner（节点子代理执行引擎）、AgentHost（父代理服务）、
//     消息/配置/日志缝等——全部经依赖注入接入，单测用 fake 替代；
//   - 基础身份类型：FlowLockInfo（运行锁信息）、CallerInfo（工具调用方身份）、
//     ChildMeta（childId → 运行位置反查）。

import type { GraphNode } from '../shared/graph-model.js'
import type { RunStatus } from '../shared/types.js'

// ---------------------------------------------------------------------------
// 常量与错误
// ---------------------------------------------------------------------------

/** 单次运行 wf_run_node 调用总上限（编排护栏）。 */
export const GLOBAL_RUN_CALL_LIMIT = 500

/**
 * subagent/end 迟到缓冲参数：childIndex 登记的窗口（startNodeTask 派发 → 编排器
 * 拿到 childId 登记）只有数个事件循环轮转，10ms × 20 次 = 200ms 远宽于窗口，
 * 同时有界（不无限重试；超限告警丢弃，避免无主事件常驻）。
 */
export const SUBAGENT_END_RETRY_DELAY_MS = 10
export const SUBAGENT_END_RETRY_MAX = 20

/** 编排器错误：稳定 code（工具层转 isError 工具结果/测试断言共用）。 */
export class WfError extends Error {
  readonly code: string
  constructor(message: string, code: string, extras?: Record<string, unknown>) {
    super(message)
    this.name = 'WfError'
    this.code = code
    if (extras) Object.assign(this, extras)
  }
}

// ---------------------------------------------------------------------------
// 依赖缝（DI seams；单测 fake / index.ts 真实适配）
// ---------------------------------------------------------------------------

/** 节点子代理执行引擎（startContinuable 创建/签名复用/followup 派发）。 */
export interface NodeRunner {
  /**
   * 启动（或复用）一个角色节点的子代理并派发本轮任务。
   * 首条创建即开始推理（官方 startContinuable 语义）；复用经 followup 派发。
   * 立即返回，不等待子代理完成——完成事件经 subagent/end 观察。
   */
  startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }>
  /** 尽力中断某子代理当前回合（保留会话；官方 interrupt 语义）。 */
  interruptChild(childId: string, sessionId: string): Promise<void>
  /**
   * 消费软截停标记（护栏）：该 child 最近一次任务是否触达 ReAct 迭代上限
   * （消费后清除）。触达上限仍正常产出——节点标记 react-capped（非失败）。
   */
  consumeReactCapped?(childId: string): boolean
}

/** 节点任务启动入参（任务块与节点级参数，经子代理引擎透传官方配置）。 */
export interface NodeStartInput {
  sessionId: string
  flowId: string
  /**
   * 运行模式（缺省按模式一处理）。模式二的服务文档存储在 services/ 目录，
   * 子代理引擎须据此分派 db-in 连线检测的读取源（getServiceAsFlow），
   * 否则模式二下 wf_db_query 永不注入（需求 §4.4.3 规则 5）。
   */
  mode?: 'mode1' | 'mode2'
  /** 已解析为角色主节点的节点（虚拟节点在进入本缝前解析）。 */
  node: GraphNode
  /** 任务块（首条 prompt / followup 内容）。 */
  blocks: Array<{ type: 'text'; text: string }>
  /** 运行级取消信号（运行停止/终止/插件卸载）。 */
  signal: AbortSignal
  /** 节点级思考强度覆盖（缺省继承节点配置；取值域以官方为准）。 */
  thinking?: string
  /** 节点级 ReAct 迭代上限覆盖（缺省继承节点配置）。 */
  iterationLimit?: number
  /** 协作组 Prompt（组卡片 data.collabPrompt；非组内成员为空字符串）。 */
  collabPrompt?: string
}

/** 注入父代理的 followup 消息（官方 Message 契约：必须带 id 与 source，否则父回合失败）。 */
export interface RootInjectedMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

/**
 * 协作通信消息（wf_ask_agent 投递/通知用）：source 使用官方「merge-extensible」
 * 扩展 kind（'coordinator' 不在官方 MessageSourceMap 内，官方消费端按未知 kind
 * fall-through，与旧项目 relay 语义一致）。
 */
export interface CoordinatorMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'coordinator'; form: 'relay'; senderSessionId: string }
}

/** 会话根 Agent 的结构化最小形状（零官方类型依赖；运行时守卫）。 */
export interface RootAgentLike {
  id: string
  status?: string
  /** 根 Agent 的 Cordis Context（官方 agents.get(id)?.ctx 可达；用于注入提示词段/模型选择）。 */
  ctx?: unknown
  followup?: (message: RootInjectedMessage) => void
  steer?: (message: CoordinatorMessage) => void
  session?: { events?: unknown[] }
}

/** 父代理回合终态（看护用；error=编排已死，aborted=用户取消）。 */
export type TurnEndInfo = { kind: 'error'; error: unknown } | { kind: 'aborted' }

/** 父代理侧宿主能力（会话根 Agent 服务；index.ts 的 CordisAgentHost 实现）。 */
export interface AgentHost {
  /** agents 服务是否可用。 */
  available(): boolean
  /** 取会话根 Agent；未激活返回 null。 */
  getRootAgent(sessionId: string): RootAgentLike | null
  /** followup 一次性注入 + 唤醒父代理（消息必须带 id/source，见 RootInjectedMessage）。 */
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void
  /** 根 Agent 会话在 afterMs 之后的最新 turn/end（无则 null；看护权威检测）。 */
  latestTurnEnd(sessionId: string, afterMs: number): TurnEndInfo | null
  /** 某子代理是否仍在运行（看护 inflight 自愈；查询失败保守返回 true）。 */
  childRunning(childId: string): boolean
}

/** 编排器配置子集（来自 Host Config，默认值与 cordis.patch.yml 一致）。 */
export interface OrchestratorConfig {
  /** 节点完整输出持久化字节上限（断点/上下文传递用）。 */
  outputFullLimit: number
  /** 文本文件内容注入上下文字符上限。 */
  documentTextLimit: number
  /** 运行空闲超时毫秒数（无 in-flight 时看护门限）。 */
  runIdleTimeoutMs: number
  /** 单节点回流重试次数默认上限（节点未配置时兜底）。 */
  retryLimitDefault: number
  /** ReAct 迭代次数默认上限（节点未配置时兜底）。 */
  reactIterationLimitDefault: number
  /** wf_ask_agent 阻塞通信超时毫秒数（超时后注入父代理裁决）。 */
  wfAskAgentTimeoutMs: number
}

/** 日志缝（默认 console；单测注入收集器断言 warn 路径）。 */
export interface OrchestratorLogger {
  warn: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

export const consoleLogger: OrchestratorLogger = {
  warn: (message, ...args) => console.warn(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
}

// ---------------------------------------------------------------------------
// 基础身份类型
// ---------------------------------------------------------------------------

/** 运行锁信息（flowLockInfo 结果；暂停保留锁，status 供消息区分）。 */
export interface FlowLockInfo {
  flowId: string
  sessionId: string
  runId: string
  flowName: string
  status: RunStatus
}

/** 工具调用方身份（工具层从 exec 派生：isChild 与 sessionId）。 */
export interface CallerInfo {
  /** 调用者是否子代理（子代理禁止调度/收尾）。 */
  isChild: boolean
  /** 调用者会话 id（根 Agent 的会话）。 */
  sessionId: string
}

/** 子代理归属反查记录（childId → 运行位置；wfRunNode 启动成功后登记）。 */
export interface ChildMeta {
  sessionId: string
  flowId: string
  nodeId: string
}
