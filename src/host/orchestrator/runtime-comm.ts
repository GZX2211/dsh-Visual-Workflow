// src/host/orchestrator/runtime-comm.ts
//
// 编排运行时协作通信层（RuntimeComm extends RuntimeExecute）：wf_ask_agent
// 三态协议（ask/reply/resolve）+ 超时裁决与审计。方法体逐字移动。

import { randomUUID } from 'node:crypto'
import {
  ASK_MESSAGE_LIMIT,
  buildAskText,
  buildTimeoutText,
  coordinatorMessage,
  type AskAgentArgs,
  type AskAgentCmd,
  type AskAgentDelivery,
  type AskAgentResult,
  type PendingAsk,
  type ResolveAction,
} from './ask-types.js'
import { statusText, truncateText } from './snapshot.js'
import { messageOf } from './helpers.js'
import type { WorkflowDocument } from '../shared/graph-model.js'
import type { RunEntry } from './run-types.js'
import { WfError, type CallerInfo, type ChildMeta } from './seams.js'
import { RuntimeExecute } from './runtime-execute.js'

export class RuntimeComm extends RuntimeExecute {
  // ---- wf_ask_agent ----------------------------------------------------------

  /** 校验调用者会话存在运行且 running（ask/reply/resolve 共用；子代理不在此拒绝）。 */
  private requireRunningRun(caller: CallerInfo): RunEntry {
    const sessionId = caller.sessionId
    if (!sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
    const run = this.activeRunForSession(sessionId)
    if (!run) throw new WfError('当前没有正在运行的工作流编排', 'WF_NO_ACTIVE_RUN')
    if (run.snapshot.status !== 'running') {
      throw new WfError(`该工作流已${statusText(run.snapshot.status)}，无法继续通信`, 'WF_STOPPED')
    }
    return run
  }

  /**
   * 节点 id → 本 run 的子代理会话 id 反查（协作成员稳定寻址，O(1)，P2-4）。
   * 借助 childByNode（nodeId → childId）反向索引命中；命中后仍需按
   * sessionId/flowId 归属校验（同一 nodeId 可能被不同 run/会话登记）。
   * 目标未启动/不属于本 run 返回 null（调用方按 WF_ASK_TARGET_UNKNOWN 处理）。
   */
  private childForNode(run: RunEntry, nodeId: string): { childId: string; meta: ChildMeta } | null {
    const childId = this.childByNode.get(nodeId)
    if (!childId) return null
    const meta = this.childIndex.get(childId)
    if (!meta) return null
    if (meta.nodeId !== nodeId || meta.sessionId !== run.snapshot.sessionId || meta.flowId !== run.snapshot.flowId) return null
    return { childId, meta }
  }

  /**
   * 构造 WF_ASK_TARGET_UNKNOWN 的可行动提示（P2-3）：按情形区分并给出下一步指向。
   *   - 目标等于发起者自身 → 提示不可自投；
   *   - 目标是本工作流节点但未/非本 run 启动 → 提示该成员可能尚未被父代理调度，请稍后重试或请父代理调度；
   *   - 目标不匹配任何成员 → 列出发起者协作块中的可用成员 id。
   */
  private async targetUnknownHint(run: RunEntry, from: string, metaFrom: ChildMeta, rawTo: string): Promise<string> {
    if (rawTo === from || rawTo === metaFrom.nodeId) {
      return '不能向自己发起协作通信（目标为发起者自身），请改用其他协作成员节点 id'
    }
    let flow: WorkflowDocument
    try {
      flow = await this.currentResolvedFlow(run)
    } catch {
      return `目标 ${rawTo} 不是当前运行的节点子代理，且暂时无法读取流程确认成员清单`
    }
    const nodes = flow.nodes ?? []
    const isFlowNode = nodes.some((n) => n.id === rawTo)
    // 发起者所在协作组的成员 id 清单（组内可发消息对象）
    const group = nodes.find(
      (n) => n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(metaFrom.nodeId),
    ) as { data?: { memberIds?: string[]; label?: string } } | undefined
    const memberIds = (group?.data?.memberIds ?? []) as string[]
    if (isFlowNode) {
      const labels = memberIds.map((id) => `「${id}」`).join('、')
      return `目标 ${rawTo} 是该工作流的节点，但尚未被启动或不属于当前运行；该成员可能还未被父代理调度，请稍后重试或请父代理先行调度。${
        labels ? `你可向组内成员发起：${labels}` : ''
      }`
    }
    if (memberIds.length > 0) {
      return `目标 ${rawTo} 不是协作块中的成员 id；你可向组内成员发起：${memberIds.map((id) => `「${id}」`).join('、')}`
    }
    return `目标 ${rawTo} 不是当前运行的节点子代理，也不是本流程中的节点 id`
  }

  /**
   * wf_ask_agent：Agent 间阻塞通信（ask/reply/resolve 三态协议）。
   *   - ask：子代理 A 向同运行节点子代理 B 发起协作消息并阻塞等待回复；
   *     投递经 delivery 缝（在线 steer 插队 / 冷态 followup 冷恢复）；
   *   - reply：目标 B 回复，解除 A 的阻塞（工具结果 = 回复文本）；
   *   - resolve：父代理对超时 ask 裁决（continue 重启计时 / resend 重发 / abort
   *     让 A 以超时错误继续）。
   * 强校验（越权拒绝）：运行锁 + childIndex 表内所有权 + 会话归属，全程写审计日志。
   * 超时后 A 仍挂起，等待父代理裁决；运行终止/插件卸载时全部挂起 ask 以
   * WF_CANCELLED 释放。
   */
  async wfAskAgent(
    caller: CallerInfo,
    childId: string,
    args: AskAgentArgs,
    delivery: AskAgentDelivery,
    callerSignal?: AbortSignal,
  ): Promise<AskAgentResult> {
    const cmd = String(args?.cmd ?? '').trim() as AskAgentCmd
    if (cmd !== 'ask' && cmd !== 'reply' && cmd !== 'resolve') {
      throw new WfError('wf_ask_agent 需要 cmd: "ask" | "reply" | "resolve"', 'WF_BAD_ARGS')
    }
    const run = this.requireRunningRun(caller)

    // ---- ask：发起协作消息并挂起等待回复 ----
    if (cmd === 'ask') {
      if (!caller.isChild) {
        throw new WfError('wf_ask_agent 的 ask 仅供子代理使用（父代理请用 resolve 处理超时）', 'WF_NOT_CHILD')
      }
      const from = childId
      const metaFrom = from ? this.childIndex.get(from) : null
      if (!metaFrom || metaFrom.sessionId !== run.snapshot.sessionId || metaFrom.flowId !== run.snapshot.flowId) {
        throw new WfError('仅当前运行中的节点子代理可以发起协作通信', 'WF_ASK_FORBIDDEN')
      }
      const rawTo = String(args?.targetChildId ?? '').trim()
      if (!rawTo) {
        throw new WfError('wf_ask_agent ask 需要 targetChildId（目标节点 id 或子代理会话 id）', 'WF_BAD_ARGS')
      }
      // 目标寻址支持两种形式：子代理会话 id（运行期随机 UUID）或 节点 id（协作块
      // 列出的成员 id —— 组成员稳定、彼此可知的寻址）。解析后统一以子代理会话 id
      // 记账；目标即使已结束/冷态仍在 childIndex（仅随 run 生命周期清理），投递缝
      // 会以 followup 冷恢复直接唤醒，无需目标保持运行中。
      let to = rawTo
      let metaTo = this.childIndex.get(rawTo)
      if (!metaTo || metaTo.sessionId !== run.snapshot.sessionId || metaTo.flowId !== run.snapshot.flowId) {
        const byNode = this.childForNode(run, rawTo)
        if (!byNode) {
          // P2-3：按情形给出可行动指引，让成员可自助纠错而非求助父代理。
          throw new WfError(await this.targetUnknownHint(run, from, metaFrom, rawTo), 'WF_ASK_TARGET_UNKNOWN')
        }
        to = byNode.childId
        metaTo = byNode.meta
      }
      if (to === from) throw new WfError('不能向自己发起协作通信', 'WF_BAD_ARGS')
      const message = String(args?.message ?? '').trim()
      if (!message) throw new WfError('wf_ask_agent ask 需要 message', 'WF_BAD_ARGS')
      for (const existing of run.asks.values()) {
        if (existing.from === from && existing.state === 'pending') {
          throw new WfError('已有挂起的协作通信等待回复，请先处理', 'WF_BUSY')
        }
      }
      const timeoutMs = Math.max(1, this.deps.config.wfAskAgentTimeoutMs)
      const askId = this.deps.uuid?.() ?? randomUUID()
      let askResolve!: (result: AskAgentResult) => void
      let askReject!: (error: unknown) => void
      const promise = new Promise<AskAgentResult>((res, rej) => {
        askResolve = res
        askReject = rej
      })
      const pending: PendingAsk = {
        askId,
        from,
        to,
        fromNodeId: metaFrom.nodeId,
        toNodeId: metaTo.nodeId,
        message: truncateText(message, ASK_MESSAGE_LIMIT),
        timeoutMs,
        expiresAt: this.now() + timeoutMs,
        state: 'pending',
        audit: [],
        promise,
        resolve: askResolve,
        reject: askReject,
        timer: null,
        delivery,
      }
      run.asks.set(askId, pending)
      this.auditAsk(pending, 'ask', `from=${from}(${metaFrom.nodeId}) to=${to}(${metaTo.nodeId})`)
      try {
        await delivery.deliver({
          sessionId: run.snapshot.sessionId,
          to,
          message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildAskText(pending), from),
          signal: run.controller.signal,
        })
        this.auditAsk(pending, 'deliver', `to=${to}`)
      } catch (error) {
        run.asks.delete(askId)
        this.auditAsk(pending, 'deliver-failed', messageOf(error))
        throw new WfError(`协作消息投递失败：${messageOf(error)}`, 'WF_DELIVERY_FAILED')
      }
      pending.expiresAt = this.now() + timeoutMs
      pending.timer = setTimeout(() => this.onAskTimeout(run, askId), timeoutMs)
      run.lastActiveAt = this.now()

      // 挂起：等待回复 / 超时裁决 / 运行终止 / 调用方取消
      const onAbort = (): void => {
        run.asks.delete(askId)
        if (pending.timer) clearTimeout(pending.timer)
        pending.reject(new WfError('该工作流已停止', 'WF_CANCELLED'))
      }
      if (callerSignal && !callerSignal.aborted) callerSignal.addEventListener('abort', onAbort, { once: true })
      else if (callerSignal?.aborted) onAbort()
      try {
        return await pending.promise
      } finally {
        callerSignal?.removeEventListener('abort', onAbort)
      }
    }

    // ---- reply：目标回复，解除发起者阻塞 ----
    if (cmd === 'reply') {
      if (!caller.isChild) {
        throw new WfError('wf_ask_agent 的 reply 仅供子代理使用', 'WF_NOT_CHILD')
      }
      const askId = String(args?.askId ?? '').trim()
      if (!askId) throw new WfError('wf_ask_agent reply 需要 askId', 'WF_BAD_ARGS')
      const pending = run.asks.get(askId)
      if (!pending) throw new WfError('协作通信不存在或已结束', 'WF_ASK_NOT_FOUND')
      if (pending.to !== childId) throw new WfError('只有消息目标可以回复该协作通信', 'WF_ASK_MISMATCH')
      if (pending.state !== 'pending') throw new WfError('该协作通信已超时，等待父代理裁决', 'WF_ASK_NOT_PENDING')
      const target = String(args?.targetChildId ?? '').trim()
      // 发起者可用「子代理会话 id」或「节点 id」任一形式回复（ask 消息文本中两值均含）
      if (target && target !== pending.from && target !== pending.fromNodeId) {
        throw new WfError('回复对象与发起者不一致', 'WF_ASK_MISMATCH')
      }
      const message = String(args?.message ?? '').trim()
      if (!message) throw new WfError('wf_ask_agent reply 需要 message', 'WF_BAD_ARGS')
      if (pending.timer) clearTimeout(pending.timer)
      pending.timer = null
      pending.state = 'resolved'
      this.auditAsk(pending, 'reply', `from=${childId}`)
      pending.resolve({ cmd: 'ask', askId, from: pending.from, to: pending.to, reply: message })
      run.asks.delete(askId)
      return { cmd: 'reply', askId, from: childId, to: pending.from }
    }

    // ---- resolve：父代理对超时 ask 裁决 ----
    if (caller.isChild) {
      throw new WfError('wf_ask_agent 的 resolve 仅供父代理使用（子代理请用 reply）', 'WF_NOT_ROOT')
    }
    const askId = String(args?.askId ?? '').trim()
    if (!askId) throw new WfError('wf_ask_agent resolve 需要 askId', 'WF_BAD_ARGS')
    const pending = run.asks.get(askId)
    if (!pending) throw new WfError('协作通信不存在或已结束', 'WF_ASK_NOT_FOUND')
    if (pending.state !== 'timed-out') {
      throw new WfError('该协作通信尚未超时，无需裁决', 'WF_ASK_NOT_TIMED_OUT')
    }
    const action = String(args?.action ?? '').trim() as ResolveAction
    if (action !== 'continue' && action !== 'resend' && action !== 'abort') {
      throw new WfError('wf_ask_agent resolve 需要 action: "continue" | "resend" | "abort"', 'WF_BAD_ARGS')
    }
    if (action === 'abort') {
      pending.state = 'aborted'
      this.auditAsk(pending, 'resolve-abort', '')
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new WfError('协作通信超时未获回复，已由父代理终止', 'WF_ASK_AGENT_TIMEOUT', { askId }))
      run.asks.delete(askId)
      return { cmd: 'resolve', askId, action }
    }
    if (action === 'resend') {
      try {
        await pending.delivery.deliver({
          sessionId: run.snapshot.sessionId,
          to: pending.to,
          message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildAskText(pending), pending.from),
          signal: run.controller.signal,
        })
        this.auditAsk(pending, 'resolve-resend', `to=${pending.to}`)
      } catch (error) {
        pending.state = 'aborted'
        this.auditAsk(pending, 'deliver-failed', messageOf(error))
        pending.reject(new WfError(`协作消息重发失败：${messageOf(error)}`, 'WF_DELIVERY_FAILED'))
        run.asks.delete(askId)
        return { cmd: 'resolve', askId, action }
      }
    } else {
      this.auditAsk(pending, 'resolve-continue', '')
    }
    pending.state = 'pending'
    pending.expiresAt = this.now() + pending.timeoutMs
    pending.timer = setTimeout(() => this.onAskTimeout(run, askId), pending.timeoutMs)
    return { cmd: 'resolve', askId, action }
  }

  /** 协作通信超时：置 timed-out 并把超时详情通知父代理（A 继续挂起等裁决）。 */
  private onAskTimeout(entry: RunEntry, askId: string): void {
    const pending = entry.asks.get(askId)
    if (!pending || pending.state !== 'pending') return
    pending.state = 'timed-out'
    pending.timer = null
    this.auditAsk(pending, 'timeout', `timeoutMs=${pending.timeoutMs}`)
    try {
      pending.delivery.notifyParent({
        sessionId: entry.snapshot.sessionId,
        message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildTimeoutText(pending), 'visual-workflow'),
      })
    } catch (error) {
      this.log().warn(`[visual-workflow] wf_ask_agent 超时通知父代理失败：${messageOf(error)}`)
    }
  }

  /** 写协作通信审计：内存审计链 + 宿主日志（越权校验的可追溯性）。 */
  private auditAsk(pending: PendingAsk, event: string, detail: string): void {
    pending.audit.push({ at: this.isoNow(), event, detail })
    this.log().info(`[visual-workflow] wf_ask_agent audit: askId=${pending.askId} ${event}${detail ? ` ${detail}` : ''}`)
  }

}