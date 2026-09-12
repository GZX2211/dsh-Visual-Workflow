// src/host/orchestrator/watchdog.ts
//
// 运行看护与陈旧记录对账（T-021）：空闲看护定时器 / 单次扫描 / 宿主重启 reconcile。
//
// 语义来源（需求文档 §4.7 规则 5 / §4.4.2 规则 6；旧项目 orchestrator.js L685-812）：
//   - 空闲超时：仅当**没有运行中子代理**（inflight 为空）且 wf_* 活动静默超过
//     runIdleTimeoutMs 才自动 stopped（子代理执行中不计空闲；subagent/end 刷新活动）；
//   - 父代理(root) 回合以 error 结束 → 自动 failed（编排已死）；aborted（对话区停止按钮，
//     官方 cancel 只停父代理回合）→ **保持运行不终止**（用户裁决：停止=打断修正，见下）；
//   - 宿主重启后：磁盘历史里残留的 running/paused 标记为 interrupted（可恢复），
//     正在执行的节点回退 pending（续跑时重试），已 ok 节点保留。
//
// 为什么 interrupted 不回退节点为 fail（§4.7 规则 5）：interrupted 语义是「宿主意外
// 关闭导致中断」，可恢复；running 节点恢复为 pending 表示「未完成、可重跑」，
// 与 ok（完成、不重跑）构成续跑判据。用户主动停止（stopped）才把 running 收敛 fail
// （runtime.ts terminalizeNodes）。

import type { FlowStore } from '../storage/flow-store.js'
import type { OrchestratorRuntime } from './runtime.js'

/** 看护扫描间隔（旧项目 15s；护栏兜底，非实时通道）。 */
export const WATCHDOG_INTERVAL_MS = 15_000

/**
 * 启动全局看护定时器（返回 disposer；host 经 ctx.effect 持有）。
 * 定时扫描 + 父代理回合报错快速路径（agent/error 事件在 index.ts 直接调用）。
 */
export function scheduleIdleWatchdog(runtime: OrchestratorRuntime, options: { intervalMs?: number } = {}): () => void {
  const timer = setInterval(() => {
    sweepWatchdogOnce(runtime).catch((error) => {
      runtime.warn(`[visual-workflow] watchdog sweep failed: ${String(error instanceof Error ? error.message : error)}`)
    })
  }, options.intervalMs ?? WATCHDOG_INTERVAL_MS)
  return () => clearInterval(timer)
}

/**
 * 单次看护扫描（抽出便于测试）：空闲超时停（无 inflight 才计）+ 父代理回合出错自动 failed。
 */
export async function sweepWatchdogOnce(runtime: OrchestratorRuntime): Promise<void> {
  const now = runtime.now()
  for (const entry of [...runtime.runs.values()]) {
    const snapshot = entry.snapshot
    if (!snapshot || snapshot.status !== 'running') continue

    // 自愈：清掉已结束/已消失的 in-flight 子代理（流产物已结束但 subagent/end 未观测到时按结束计）
    if (entry.inflight.size > 0) {
      for (const childId of [...entry.inflight]) {
        if (!runtime.childRunning(childId)) {
          entry.inflight.delete(childId)
          entry.lastActiveAt = now
        }
      }
    }

    if (entry.inflight.size === 0 && now - entry.lastActiveAt >= runtime.idleTimeoutMs) {
      await runtime.terminateRun(entry, {
        status: 'stopped',
        summary: '编排空闲超时自动停止（父代理可能未完成收尾，请检查会话）',
        abortReason: 'idle-timeout',
      })
      continue
    }

    // 父代理回合终态：
    //   - error：编排确实死了（模型/工具/官方内部错误）→ failed；
    //   - aborted：**不终止运行**（用户裁决）。aborted 的唯一来源是对话区官方「停止」
    //     按钮（官方 ISession.cancel 只停当前回合、保留 inbox 待办，不级联掐死子代理），
    //     其语义是「打断父代理、让我修正一句再说」而非「停止工作流」。因此运行保持
    //     running（画布继续回显、子代理继续跑完并回写），用户下一条消息即让父代理接着调度；
    //     真正的停止只由工作台停止按钮（stopRun）/空闲超时承担。
    const terminal = runtime.parentTurnTerminal(entry)
    if (terminal?.kind === 'error') {
      await runtime.failRunForParentError(entry, terminal.error)
    } else if (terminal?.kind === 'aborted') {
      runtime.warn('[visual-workflow] 父代理回合被用户中止（对话区停止）：保持运行，等待下一次调度')
    }
  }
}

/**
 * 宿主重启后对账：把持久化历史里残留的 running/paused 记录标记为 interrupted
 * （进程已死，可恢复）。返回处理的记录数（Host init 时调用；旧项目 reconcileStaleRuns 同构）。
 */
export async function reconcileStaleRuns(store: FlowStore, options: { now?: () => number } = {}): Promise<number> {
  const runIds = await store.listAllRunIds()
  let changed = 0
  for (const runId of runIds) {
    const run = await store.getRun(runId)
    if (!run || (run.status !== 'running' && run.status !== 'paused')) continue
    const now = options.now?.() ?? Date.now()
    const endedAt = new Date(now).toISOString()
    await store.saveRun({
      ...run,
      status: 'interrupted',
      endedAt,
      summary: '宿主进程重启，运行已中断（可恢复）',
      nodes: run.nodes.map((node) =>
        node.status === 'running'
          ? { ...node, status: 'pending' as const, endedAt }
          : node
      ),
    })
    changed += 1
  }
  return changed
}
