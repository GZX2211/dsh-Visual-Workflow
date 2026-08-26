// src/host/service/sessions-map.ts
//
// userId → sessionId 稳定映射（模式二多用户会话隔离通道）。
// 持久化于 <dataDir>/services/<serviceId>.sessions.json（FlowStore 原子写）；
// 内存缓存避免每请求读盘；同 userId 并发解析经 pending 去重保证单 sessionId。
// 服务进程重启后从磁盘恢复（映射持久化语义）。

import { randomUUID } from 'node:crypto'
import type { FlowStore } from '../storage/flow-store.js'

/** 会话 id 前缀（与官方 headless one-shot 的 session-<uuid> 形态一致）。 */
export const SESSION_ID_PREFIX = 'session-'

export interface SessionMapDeps {
  /** 数据层（userIdMap 读 / mergeUserIdMap 原子合并写）。 */
  store: FlowStore
  /** 服务 id（映射文件按服务隔离）。 */
  serviceId: string
  /** 新 sessionId 生成器（测试可控；缺省 randomUUID）。 */
  newSessionId?: () => string
}

/**
 * userId → sessionId 映射表（每服务一个实例）。
 * resolve 为幂等通道：同 userId 恒返回同 sessionId（缓存命中即返回）。
 */
export class SessionMap {
  private readonly cache = new Map<string, string>()
  private readonly pending = new Map<string, Promise<string>>()

  constructor(private readonly deps: SessionMapDeps) {}

  /** 取 userId 的稳定 sessionId（首次解析时持久化映射并缓存）。 */
  async resolve(userId: string): Promise<string> {
    const cached = this.cache.get(userId)
    if (cached) return cached
    const inflight = this.pending.get(userId)
    if (inflight) return inflight
    const task = this.ensure(userId)
    this.pending.set(userId, task)
    try {
      return await task
    } finally {
      this.pending.delete(userId)
    }
  }

  /** 已解析的 sessionId 快照（测试/诊断用）。 */
  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.cache)
  }

  private async ensure(userId: string): Promise<string> {
    // 磁盘优先：服务重启后恢复既有映射（映射持久化语义）
    const map = await this.deps.store.userIdMap(this.deps.serviceId)
    const hit = map[userId]
    if (hit) {
      this.cache.set(userId, hit)
      return hit
    }
    const sessionId = `${SESSION_ID_PREFIX}${this.deps.newSessionId?.() ?? randomUUID()}`
    // 合并写入把读改写收进同一把锁（FlowStore.mergeUserIdMap），不同 userId
    // 并发首解析时不再互相覆盖磁盘映射（旧实现读改写跨两次锁作用域，会丢映射）。
    const merged = await this.deps.store.mergeUserIdMap(this.deps.serviceId, { [userId]: sessionId })
    const final = merged[userId] ?? sessionId
    this.cache.set(userId, final)
    return final
  }
}
