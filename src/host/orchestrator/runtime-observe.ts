// src/host/orchestrator/runtime-observe.ts
//
// 编排运行时观察回写层（RuntimeObserve extends RuntimeComm）：subagent/end
// 事件回写节点状态（ok/fail/react-capped）、唤醒 wait 阻塞与协作组聚合。
// 方法体逐字移动。

import type { WorkflowDocument } from '../shared/graph-model.js'
import { OUTPUT_SUMMARY_LIMIT, lastAssistantText, setNodeStatus } from './snapshot.js'
import { SUBAGENT_END_RETRY_DELAY_MS, SUBAGENT_END_RETRY_MAX } from './seams.js'
import type { RunEntry, SubagentEndInfo } from './run-types.js'
import { RuntimeComm } from './runtime-comm.js'

export class RuntimeObserve extends RuntimeComm {
  // ---- subagent/end 观察 ------------------------------------------------------

  /**
   * 子代理结束观察：
   *   - 运行快照：completed/max-tokens → 节点 ok（outputSummary 取最后一条 assistant 文本）；
   *     error/aborted 等 → 节点 fail；
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
      const outputText = lastAssistantText(info?.lastAssistantMessage, OUTPUT_SUMMARY_LIMIT)
      // 软截停（护栏）：触达 ReAct 上限仍正常产出——标记 react-capped（非失败）
      const reactCapped = this.deps.runner.consumeReactCapped?.(childId) === true
      if (completed) {
        setNodeStatus(s, meta.nodeId, reactCapped ? 'react-capped' : 'ok', {
          output: outputText || '(子代理已完成，但无可汇总文本)',
          outputFullLimit: this.deps.config.outputFullLimit,
          now: this.now(),
        })
        // 协作组聚合：成员完成后若组内全部成员 ok/react-capped → 组卡片记为 ok
        // （「组内全部 ok -> 组卡片记为 ok」；只做回显，不干预父代理调度）
        await this.markGroupOkIfComplete(entry, meta.nodeId)
      } else {
        setNodeStatus(s, meta.nodeId, 'fail', { now: this.now() })
      }
      await this.persistWarn(entry)
      // 唤醒阻塞等待（wait:true；与 subagent/end 共用同一完成通道）
      const waitKey = `${s.id}:${meta.nodeId}`
      const waiter = entry.waiters.get(waitKey)
      if (waiter) {
        entry.waiters.delete(waitKey)
        waiter.resolve({ nodeId: meta.nodeId, status: completed ? 'ok' : 'fail', childId, output: outputText })
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
   * 协作组聚合：某成员节点完成后，若其所属协作组全部成员均为
   * ok/react-capped，把组卡片标记为 ok（只影响运行回显，不干预父代理调度）。
   * 组卡片单向推进：仅 pending → ok；成员后续重试/失败不回退组卡片。
   * 流程读取失败时跳过聚合（下一次成员完成事件重试）。
   */
  private async markGroupOkIfComplete(entry: RunEntry, memberNodeId: string): Promise<void> {
    const snapshot = entry.snapshot
    if (snapshot.status !== 'running' && snapshot.status !== 'paused') return
    let flow: WorkflowDocument
    try {
      flow = await this.currentResolvedFlow(entry)
    } catch {
      return
    }
    for (const group of flow.nodes) {
      if (group.kind !== 'group' || !(group.data.memberIds ?? []).includes(memberNodeId)) continue
      const allDone = (group.data.memberIds ?? []).every((id) => {
        const record = snapshot.nodes.find((n) => n.nodeId === id)
        return record !== undefined && (record.status === 'ok' || record.status === 'react-capped')
      })
      if (!allDone) continue
      const current = snapshot.nodes.find((n) => n.nodeId === group.id)
      if (current && current.status === 'pending') {
        setNodeStatus(snapshot, group.id, 'ok', { output: '（协作组）全部成员已完成', now: this.now() })
      }
    }
  }
}