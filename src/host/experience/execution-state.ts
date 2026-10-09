// src/host/experience/execution-state.ts
//
// 初始化状态表（进程内内存）。
//
// 为什么状态在内存而不落盘：它表达的是「本次运行实例内，某主体是否已经取过该类型的生成 Prompt」，
// 属于运行期协议执行状态而非经验事实；落盘会引入与运行生命周期不一致的持久状态清理问题。
// 状态的释放路径有两条：按会话清理（run 终态）与会话数上界逐出（长驻宿主进程兜底）。

import type { ExperienceType } from "../shared/asset-types.js"
import { MAX_INITIALIZED_SESSIONS } from "./constants.js"

/** 一条初始化记录（Prompt 行 id 与版本用于经验 provenance）。 */
export interface ExperienceInitializationRecord {
  sessionId: string
  subjectId: string
  experienceType: ExperienceType
  generationPromptId: string
  generationPromptVersion: string
  initialized: true
  /** 首次标记时间（同一主体同一类型重复初始化时保持不变）。 */
  initializedAt: number
  /** 最近一次刷新时间（重复初始化只刷新这里与 Prompt 版本）。 */
  refreshedAt: number
}

/** 标记入参。 */
export interface ExperienceInitializationInput {
  sessionId: string
  subjectId: string
  experienceType: ExperienceType
  generationPromptId: string
  generationPromptVersion: string
}

/** 状态表构造参数。 */
export interface ExperienceExecutionStateOptions {
  now?: () => number
  /** 会话数上界（缺省取域常量；最小 1）。 */
  maxSessions?: number
}

function subjectKey(subjectId: string, experienceType: ExperienceType): string {
  return `${subjectId}\u0000${experienceType}`
}

/**
 * 按「会话 → 主体 + 类型」组织的初始化状态表。
 * 读操作返回副本，调用方无法通过返回值改写内部状态。
 */
export class ExperienceExecutionState {
  private readonly sessions = new Map<string, Map<string, ExperienceInitializationRecord>>()
  private readonly now: () => number
  private readonly maxSessions: number

  constructor(options: ExperienceExecutionStateOptions = {}) {
    this.now = options.now ?? Date.now
    this.maxSessions = Math.max(1, Math.floor(options.maxSessions ?? MAX_INITIALIZED_SESSIONS))
  }

  /** 读取初始化记录；未初始化返回 null。 */
  readInitialized(sessionId: string, subjectId: string, experienceType: ExperienceType): ExperienceInitializationRecord | null {
    const record = this.sessions.get(sessionId)?.get(subjectKey(subjectId, experienceType))
    return record ? { ...record } : null
  }

  /** 标记初始化（幂等：同一键重复标记只刷新，不新增记录）。 */
  markInitialized(input: ExperienceInitializationInput): ExperienceInitializationRecord {
    let records = this.sessions.get(input.sessionId)
    if (!records) {
      records = new Map<string, ExperienceInitializationRecord>()
      this.sessions.set(input.sessionId, records)
      this.evictOldestSessions()
    }
    const key = subjectKey(input.subjectId, input.experienceType)
    const now = this.now()
    const record: ExperienceInitializationRecord = {
      sessionId: input.sessionId,
      subjectId: input.subjectId,
      experienceType: input.experienceType,
      generationPromptId: input.generationPromptId,
      generationPromptVersion: input.generationPromptVersion,
      initialized: true,
      initializedAt: records.get(key)?.initializedAt ?? now,
      refreshedAt: now,
    }
    records.set(key, record)
    return { ...record }
  }

  /** 释放某会话的全部记录（run 终态清理）；返回释放条数（幂等）。 */
  clearBySession(sessionId: string): number {
    const records = this.sessions.get(sessionId)
    if (!records) return 0
    const count = records.size
    this.sessions.delete(sessionId)
    return count
  }

  /** 释放全部记录（插件卸载）。 */
  clearAll(): void {
    this.sessions.clear()
  }

  /** 当前会话数（诊断与上界断言用）。 */
  get sessionCount(): number {
    return this.sessions.size
  }

  /** 当前记录数（诊断与幂等断言用）。 */
  get recordCount(): number {
    let total = 0
    for (const records of this.sessions.values()) total += records.size
    return total
  }

  /** 会话数超上界时逐出最早会话（Map 迭代顺序即插入顺序）。 */
  private evictOldestSessions(): void {
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) return
      this.sessions.delete(oldest)
    }
  }
}
