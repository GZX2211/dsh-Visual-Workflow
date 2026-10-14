// src/host/orchestrator/runtime-observe.ts
//
// 编排运行时观察回写层（RuntimeObserve extends RuntimeComm）：subagent/end
// 事件回写节点状态（ok/fail/react-capped）、唤醒 wait 阻塞与成员待命（armed）判定。
// 方法体逐字移动。

import { memberGroupId } from '../graph/index.js'
import { lastAssistantText, setNodeStatus } from './snapshot.js'
import { SUBAGENT_END_RETRY_DELAY_MS, SUBAGENT_END_RETRY_MAX } from './seams.js'
import type { RunEntry, SubagentEndInfo } from './run-entry.js'
import { RuntimeComm } from './runtime-comm.js'

export class RuntimeObserve extends RuntimeComm {
  // ---- subagent/end 观察 ------------------------------------------------------

  /**
   * 子代理结束观察：
   *   - 运行快照：completed → 节点 ok（outputSummary 取最后一条 assistant 文本）；
   *     error/aborted 等 → 节点 fail；max-tokens 亦为 fail（内容被硬截断，Bug 19）；
   *   - 已退役 child（被重建替换的旧子代理）的事件静默丢弃，不参与节点结论；
   *   - 清空 inflight、刷新 lastActiveAt（避免空闲看护误停）；
   *   - 唤醒 wait:true 阻塞等待器（ok/fail + output）。
   * 只观察 DSH 事件，不向父代理注入任何额外内容——父代理继续推进由官方汇报链路驱动。
   * 暂停中的运行（paused）同样回写节点状态（该节点确实完成了）。
   */
  async handleSubagentEnd(info: SubagentEndInfo): Promise<void> {
    const childId = String(info?.id ?? '')
    if (!childId) return
    const meta = this.childIndex.get(childId)
    // childIndex 尚未登记（极快完成/同步失败的子代理事件先于登记到达）：
    // 不能静默丢弃——否则 wait:true 等待器永久挂起、inflight 残留。有界重试等待登记。
    if (!meta) {
      this.deferSubagentEnd(info, 0)
      return
    }
    // 已退役 child（同节点配置签名变化后被替换的旧子代理）：其事件**静默丢弃**。
    // 为什么不能照常回写（2026.10 修复）：旧子代理与新子代理共用同一 nodeId，
    // 旧配置的产出/结论会覆写新子代理正在推进的节点状态（节点状态错位、输出张冠李戴）。
    // 引擎已尽力中断旧 child，但 interrupt 是尽力而为——此处是事件侧的最后一道防线。
    // 同时从 inflight 摘除：它不再是本轮运行的在途执行者（不参与空闲看护判定）。
    if (meta.retired === true) {
      for (const entry of this.runs.values()) {
        if (entry.snapshot.sessionId === meta.sessionId && entry.snapshot.flowId === meta.flowId) {
          entry.inflight.delete(childId)
        }
      }
      this.log().debug(`[visual-workflow] 已退役子代理的结束事件被丢弃：childId=${childId} node=${meta.nodeId}`)
      return
    }
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId !== meta.sessionId || s.flowId !== meta.flowId) continue
      entry.inflight.delete(childId)
      entry.lastActiveAt = this.now()
      if (s.status !== 'running' && s.status !== 'paused') return
      const stopReason = String(info?.stopReason ?? '')
      // max-tokens = 模型输出被硬截断（内容不完整），不能视为成功（Bug 19）；
      // 仅 completed 才算节点成功；ReAct 软截停由 consumeReactCapped 另判 react-capped。
      const completed = stopReason === 'completed'
      // 完整产出先取全量（limit=0 不截断），再由 setNodeStatus 按两套口径各自截断：
      //   - nodes[].output        ← config.outputFullLimit（默认 100KB；断点回填与下游 ctx 注入的读取源）
      //   - nodes[].outputSummary ← OUTPUT_SUMMARY_LIMIT（6000 字；仅供界面展示）
      // 历史 BUG（2026.09 修复）：此处曾用 OUTPUT_SUMMARY_LIMIT 先截断再交给 setNodeStatus，
      // 导致 outputFullLimit 形同虚设（完整产出实际卡在 6000 字），下游节点与断点续跑
      // 都只能拿到被砍掉的产出。
      const outputText = lastAssistantText(info?.lastAssistantMessage, 0)
      // 软截停（护栏）：触达 ReAct 上限仍正常产出——标记 react-capped（非失败）
      const reactCapped = this.deps.runner.consumeReactCapped?.(childId) === true
      // P0-1：Team 成员回合结束 ≠ 终态完成——它在团队内仍可被 send_message 唤醒，
      // 落「armed/待命」中间态（显示为「等待」），避免被误判为终态 ok。
      const inGroup = completed && !reactCapped && (await this.teamMemberArmed(entry, meta.nodeId))
      const finalStatus: 'ok' | 'armed' | 'react-capped' | 'fail' = completed
        ? (reactCapped ? 'react-capped' : (inGroup ? 'armed' : 'ok'))
        : 'fail'
      setNodeStatus(s, meta.nodeId, finalStatus, {
        output: outputText || '(子代理已完成，但无可汇总文本)',
        outputFullLimit: this.deps.config.outputFullLimit,
        now: this.now(),
        stopReason,
        recordTurn: true,
      })
      await this.persistWarn(entry)
      // 唤醒阻塞等待（wait:true；与 subagent/end 共用同一完成通道）。armed 视同完成。
      const waitKey = `${s.id}:${meta.nodeId}`
      const waiter = entry.waiters.get(waitKey)
      if (waiter) {
        entry.waiters.delete(waitKey)
        waiter.resolve({ nodeId: meta.nodeId, status: finalStatus === 'fail' ? 'fail' : 'ok', childId, output: outputText })
      }
      return
    }
  }

  /**
   * 迟到 subagent/end 有界重试：等待 childIndex 完成登记后重放事件。
   * 防御性兜底——正常路径事件必然晚于登记到达，重试一次即命中；
   * 连续超限（20 次/200ms）说明 childId 无主（run 已清理），告警后丢弃。
   */
  private deferSubagentEnd(info: SubagentEndInfo, tries: number): void {
    if (this.disposed) return
    if (tries >= SUBAGENT_END_RETRY_MAX) {
      this.log().warn('[visual-workflow] subagent/end 缓冲重试超限丢弃：childId=' + String(info?.id ?? ''))
      return
    }
    setTimeout(() => {
      if (this.disposed) return
      const childId = String(info?.id ?? '')
      if (!childId) return
      if (this.childIndex.has(childId)) void this.handleSubagentEnd(info)
      else this.deferSubagentEnd(info, tries + 1)
    }, SUBAGENT_END_RETRY_DELAY_MS)
  }

  /**
   * 成员回合结束的「待命（armed）」判定——成员运行的权威读源是**官方 roster**。
   *
   * 语义：成员一轮产出结束、但在团队内仍可被 send_message 唤醒，故不是终态。
   *   - 官方 Team 可用：查官方成员状态，只有 `inactive`（当前无回合在执行）才算待命；
   *     running/provisioning 说明仍在执行或创建，failed 说明成员已不可用（落 ok 会掩盖失败）。
   *   - 官方不可用（成员已降级为普通可延续子代理）：退回图判定——是团队成员即待命。
   * 查询/读图失败时保守返回 false（不阻断回写，落 ok，保留旧行为）。
   *
   * Team 卡片（包裹层）不参与运行事实：本层不再聚合、不再写组状态（用户裁决 2026-10）。
   */
  private async teamMemberArmed(entry: RunEntry, nodeId: string): Promise<boolean> {
    const status = this.deps.runner.teamMemberStatusOf?.(entry.snapshot.sessionId, nodeId)
    if (status !== undefined && status !== null) return status === 'inactive'
    try {
      const flow = await this.currentResolvedFlow(entry)
      return memberGroupId(flow, nodeId) !== null
    } catch {
      return false
    }
  }
}