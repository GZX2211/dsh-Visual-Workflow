// Host + Client 共享契约：run 运行快照（纯类型，零运行时依赖）。
//
// 职责：定义一次 run 的持久化状态形状（runs/<runId>.json）与节点执行记录及其
// 断点回填视图。字段语义与依据见各字段 JSDoc（架构文档 §4.3 状态机 / §6.1，
// 需求文档 §4.7 断点续跑）。
//
// 纯度契约（见 ./AGENTS.md）：本文件只允许 `import type`，不得引入运行时 import，
// 也不得定义运行时值。

import type { OrgMeta } from './org-meta.js'

// ---------------------------------------------------------------------------
// run 快照（runs/<runId>.json，架构文档 §6.1）
// ---------------------------------------------------------------------------

/** run 运行状态：运行/暂停/完成/失败/停止/中断（架构文档 §4.3 状态机 + §6.1）。 */
export type RunStatus =
  | 'running' // 运行中
  | 'paused' // 已暂停（暂停门触发，保留运行锁，需求文档 §4.7 规则 4）
  | 'completed' // 已完成
  | 'failed' // 失败
  | 'stopped' // 已停止（用户主动停止）
  | 'interrupted' // 已中断（宿主重启导致，可恢复，需求文档 §4.7 规则 5）

/** 单节点运行状态（架构文档 §6.1 nodes[].status）。 */
export type NodeRunStatus =
  | 'pending' // 待执行
  | 'running' // 执行中
  | 'armed' // 待命（协作组成员：回合结束但仍在协作组内可被唤醒，非终态；父代理 wf_finish 后终态化。修复 P0-1）
  | 'ok' // 成功（产出可回填）
  | 'fail' // 失败（异常/终止；非 ok 不继承，续跑重试）
  | 'skipped' // 已跳过
  | 'react-capped' // ReAct 软截停（非失败，正常收尾产出，架构文档 §4.4 护栏）

/**
 * 运行快照：一次 run 的完整持久化状态（架构文档 §6.1 逐字段）。
 * 断点续跑：每次续跑生成一条新 run 记录，节点快照=全量节点，已 ok 节点状态继承
 * 自旧 run 并标记来源，经 resumedFromRunId 追溯继承链（需求文档 §4.7 规则 2）。
 */
export interface RunSnapshot {
  /** run 稳定标识（runId）。 */
  id: string
  /** 关联工作流 id（flowId）。 */
  flowId: string
  /** 工作流名称（历史面板展示用）。 */
  flowName: string
  /** 归属会话 id。 */
  sessionId: string
  /** 运行模式（mode1 编排执行 / mode2 后台服务）。 */
  mode: 'mode1' | 'mode2'
  /** 运行状态。 */
  status: RunStatus
  /** 开始时间（ISO 字符串）。 */
  startedAt: string
  /** 结束时间（ISO 字符串，未结束时为 null）。 */
  endedAt: string | null
  /** 运行摘要文本（最终汇总/失败原因提示）。 */
  summary: string
  /** 断点续跑：继承的旧 run id（新 run 记录继承链，需求文档 §4.7 规则 2）。 */
  resumedFromRunId?: string
  /** 断点续跑：从哪个节点恢复（暂停节点 id，需求文档 §4.7 规则 3）。 */
  resumeFromNodeId?: string
  /**
   * 元参数冻结副本（D-13）：startRun 时把「有效元参数（模板 ← 实例覆盖）」的副本
   * 写入快照，供审计与后续评估/重组还原当时预算；续跑继承旧快照的冻结值（不重读）。
   * 未配置元参数时不写（保持既有快照形状，旧数据兼容）。
   */
  meta?: OrgMeta
  /**
   * 本 run 已完成的父代理闸门次数（D-21：**不含首次编排**）。
   * 落位说明（P3）：放在快照而不是内存 RunEntry —— 预算必须可审计、且续跑要继承
   * （`buildResumedSnapshot` 深拷贝旧快照即自动带上）；仅由 `wf_graph_patch(mark_node)`
   * 标记 ok 时递增，父代理的自动完成路径永远不会写它。
   */
  milestoneUsed?: number
  /** 节点执行记录列表（仅可执行 agent 节点；协作组/阶段/文件/数据库不做执行记录）。 */
  nodes: Array<{
    /** 节点 id。 */
    nodeId: string
    /** 该节点当前执行状态。 */
    status: NodeRunStatus
    /** 尝试次数（回流重试计数，需求文档 §4.2.3.2 规则 3）。 */
    attempts: number
    /** 节点开始时间（ISO 字符串或 null）。 */
    startedAt: string | null
    /** 节点最近结束时间（ISO 字符串或 null；随回合刷新，P0-2）。 */
    endedAt: string | null
    /** 节点完整输出（默认上限 100KB，用于断点/上下文传递，需求文档 §4.7 规则 7）。 */
    output: string
    /** 输出摘要（显示截断，默认 6000 字，需求文档 §4.7 规则 7）。 */
    outputSummary: string
    /** 是否继承自旧 run（断点恢复，已 ok 节点不重跑，需求文档 §4.7 规则 6）。 */
    resumed?: boolean
    /** 最近一次回合的终止原因（stop/interrupt/fail/react-capped/completed；用于父代理区分用户停止与异常失败，P2-5）。 */
    stopReason?: string
    /** 回合明细（可续跑节点每次被唤醒执行为一回合；P0-2）。 */
    turns?: Array<{
      /** 回合开始时间。 */
      startedAt: string | null
      /** 回合结束时间。 */
      endedAt: string | null
      /** 回合终止原因。 */
      stopReason?: string
      /** 回合输出摘要。 */
      outputSummary: string
    }>
  }>
}

// ---------------------------------------------------------------------------
// 节点输出记录（断点回填用，架构文档 §6.1 nodes[] 的提取视图 / 需求文档 §4.7 规则 7）
// ---------------------------------------------------------------------------

/**
 * 节点输出记录：运行快照中单节点产出的独立视图，供断点续跑回填 ctx 连线上下文
 * （需求文档 §4.7 规则 6：已 ok 节点完整输出随断点重新可用，作为 ctx 连线注入后续节点）。
 * 与 RunSnapshot.nodes[i] 同源，抽取为独立接口便于 resume 任务（T-027）复用。
 */
export interface NodeOutputRecord {
  /** 节点 id。 */
  nodeId: string
  /** 节点执行状态（回填仅在 ok / react-capped 时注入产出）。 */
  status: NodeRunStatus
  /** 尝试次数。 */
  attempts: number
  /** 节点开始时间（ISO 字符串或 null）。 */
  startedAt: string | null
  /** 节点结束时间（ISO 字符串或 null）。 */
  endedAt: string | null
  /** 节点完整输出（用于断点回填/上下文传递）。 */
  output: string
  /** 输出摘要（界面展示截断）。 */
  outputSummary: string
  /** 是否继承自旧 run。 */
  resumed?: boolean
}
