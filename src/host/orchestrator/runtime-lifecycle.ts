// src/host/orchestrator/runtime-lifecycle.ts
//
// 编排运行时终止收尾层（RuntimeLifecycle extends RuntimeObserve）：统一终止
// （中止控制器/尽力中断子代理/写终态/释放锁）、用户停止与父代理出错自动 failed。
// 方法体逐字移动。

import { terminalizeNodes } from './snapshot.js'
import { messageOf } from './helpers.js'
import type { RunEntry, TerminateOptions } from './run-types.js'
import { RuntimeObserve } from './runtime-observe.js'

export class RuntimeLifecycle extends RuntimeObserve {
  // ---- 终止 / 停止 ------------------------------------------------------------

  /**
   * 统一终止运行：中止控制器（含阻塞中的 wait/提问）、尽力中断运行中子代理、
   * 写终态、持久化、释放锁（内存锁随状态自然释放）。幂等。
   * 终态条目随即从内存 runs 表释放（历史记录在磁盘，由 FlowStore 提供），
   * 防止长期运行内存膨胀；running/paused 条目保留（续跑/锁查询需要）。
   */
  async terminateRun(entry: RunEntry, options: TerminateOptions): Promise<boolean> {
    const snapshot = entry.snapshot
    if (!snapshot || (snapshot.status !== 'running' && snapshot.status !== 'paused')) return false

    // 1. 中止控制器：阻塞中的 wait 等待器随之取消
    entry.controller.abort(options.abortReason ?? `terminate-${options.status}`)
    // 2. 尽力中断运行中的子代理回合（防止后台空转）
    for (const childId of [...entry.inflight]) {
      try {
        await this.deps.runner.interruptChild(childId, snapshot.sessionId)
      } catch {
        // 中断尽力而为
      }
    }
    entry.inflight.clear()
    // 3. 收尾状态
    snapshot.status = options.status
    snapshot.summary = options.summary
    snapshot.endedAt = this.isoNow()
    terminalizeNodes(snapshot, this.now(), options.status === 'stopped' ? 'stop' : 'interrupt')
    this.rejectWaiters(entry)
    this.rejectAsks(entry)
    await this.persistWarn(entry)
    // 4. 释放内存条目（终态记录已持久化；幂等基于 snapshot.status，删除后
    //    重复 terminateRun(entry) 仍返回 false）
    this.runs.delete(snapshot.id)
    return true
  }

  /** 用户停止运行（控制栏停止按钮；幂等）。 */
  async stopRun(runId: string): Promise<void> {
    const entry = this.runs.get(runId)
    if (!entry) return
    await this.terminateRun(entry, { status: 'stopped', summary: '运行已停止', abortReason: 'user-stop' })
  }

  /** 父代理回合以 error 结束（编排已死）→ 自动把运行标记为 failed。 */
  async failRunForParentError(entry: RunEntry, error: unknown): Promise<void> {
    const message = messageOf(error)
    const summary = message ? `编排父代理执行出错：${message}` : '编排父代理执行出错（未知错误）'
    await this.terminateRun(entry, { status: 'failed', summary, abortReason: 'parent-turn-error' })
  }

}