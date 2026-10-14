// src/host/orchestrator/runtime-comm.ts
//
// 编排运行时协作通信层（RuntimeComm extends RuntimeExecute）：wf_ask_agent
// 两态协议（ask/reply）+ 待回复登记与审计。ask 不挂起调用方（非阻塞），
// reply 反向投递回复到发起者。

import { randomUUID } from 'node:crypto'
import {
  ASK_MESSAGE_LIMIT,
  buildAskText,
  buildReplyText,
  coordinatorMessage,
  type AskAgentArgs,
  type AskAgentCmd,
  type AskAgentDelivery,
  type AskAgentResult,
  type PendingAsk,
} from './ask-protocol.js'
import { truncateText } from './snapshot.js'
import { WfError, messageOf } from './errors.js'
import type { WorkflowDocument } from '../shared/graph-model.js'
import type { RunEntry } from './run-entry.js'
import { type CallerInfo, type ChildMeta } from './seams.js'
import { RuntimeExecute } from './runtime-execute.js'

export class RuntimeComm extends RuntimeExecute {
  // ---- wf_ask_agent ----------------------------------------------------------

  /** 校验调用者会话存在运行且 running（ask/reply 共用；子代理不在此拒绝）。 */
  private requireRunningRun(caller: CallerInfo): RunEntry {
    const sessionId = caller.sessionId
    if (!sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session', 'WF_BAD_CALLER')
    const run = this.activeRunForSession(sessionId)
    if (!run) throw new WfError('WF_NO_ACTIVE_RUN: no running orchestration in this session', 'WF_NO_ACTIVE_RUN')
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
      return 'the target is the sender itself; use another member node id'
    }
    let flow: WorkflowDocument
    try {
      flow = await this.currentResolvedFlow(run)
    } catch {
      return `target ${rawTo} is not a node child of this run, and the flow cannot be read right now to confirm the members`
    }
    const nodes = flow.nodes ?? []
    const isFlowNode = nodes.some((n) => n.id === rawTo)
    // 发起者所在 协作组的成员 id 清单（组内可发消息对象）
    const group = nodes.find(
      (n) => n.kind === 'group' && ((n.data.memberIds ?? []) as string[]).includes(metaFrom.nodeId),
    ) as { data?: { memberIds?: string[]; label?: string } } | undefined
    const memberIds = (group?.data?.memberIds ?? []) as string[]
    if (isFlowNode) {
      const labels = memberIds.map((id) => `"${id}"`).join(', ')
      return `target ${rawTo} is a node of this workflow but was not started in this run; the parent agent may not have scheduled it yet — retry later or ask the parent agent to schedule it first.${
        labels ? ` Members you can reach: ${labels}` : ''
      }`
    }
    if (memberIds.length > 0) {
      return `target ${rawTo} is not a member id of your collaboration block; members you can reach: ${memberIds.map((id) => `"${id}"`).join(', ')}`
    }
    return `target ${rawTo} is neither a node child of this run nor a node id of this workflow`
  }

  /**
   * wf_ask_agent：Agent 间协作通信（ask/reply 两态协议，非阻塞）。
   *   - ask：子代理 A 向同运行节点子代理 B 投递协作消息并登记待回复，
   *     随即返回受理凭证（{cmd:'ask', askId, from, to}）；A 不挂起、继续执行；
   *     投递经 delivery 缝（在线 steer 插队 / 冷态 followup 冷恢复）；
   *   - reply：目标 B 答复，回复文本经同一投递缝反向投递给发起者 A
   *     （作为新消息抵达，由 A 的后续回合处理）；
   * 强校验（越权拒绝）：运行锁 + childIndex 表内所有权 + 会话归属，全程写审计日志。
   * 待回复登记按 TTL 惰性清理：到期记录在下次调用时被移除，其 askId 不再接受 reply。
   */
  async wfAskAgent(
    caller: CallerInfo,
    childId: string,
    args: AskAgentArgs,
    delivery: AskAgentDelivery,
    callerSignal?: AbortSignal,
  ): Promise<AskAgentResult> {
    const cmd = String(args?.cmd ?? '').trim() as AskAgentCmd
    if (cmd !== 'ask' && cmd !== 'reply') {
      throw new WfError('WF_BAD_ARGS: wf_ask_agent requires cmd: "ask" | "reply"', 'WF_BAD_ARGS')
    }
    const run = this.requireRunningRun(caller)
    // TTL 惰性清理：无定时器，只在通信调用进入时按时间戳收割过期登记。
    this.sweepExpiredAsks(run)

    // ---- ask：投递协作消息并登记待回复（不挂起调用方） ----
    if (cmd === 'ask') {
      if (!caller.isChild) {
        throw new WfError('WF_NOT_CHILD: wf_ask_agent ask is available to child agents only', 'WF_NOT_CHILD')
      }
      const from = childId
      const metaFrom = from ? this.childIndex.get(from) : null
      if (!metaFrom || metaFrom.sessionId !== run.snapshot.sessionId || metaFrom.flowId !== run.snapshot.flowId) {
        throw new WfError('WF_ASK_FORBIDDEN: only a node child of the running workflow may start collaboration messaging', 'WF_ASK_FORBIDDEN')
      }
      // 已退役 child（配置签名变化后被替换的旧子代理）：不接受其协作请求。
      // 它已不是该节点的当前执行者，其 ask/reply 会与承载同一 nodeId 的新子代理混淆
      // （旧子代理可能仍在收尾回复，若不拦会把协作状态错记到新回合上）。
      if (metaFrom.retired === true) {
        throw new WfError('WF_ASK_FORBIDDEN: this node child was replaced by an updated configuration and can no longer start collaboration messaging', 'WF_ASK_FORBIDDEN')
      }
      const rawTo = String(args?.targetChildId ?? '').trim()
      if (!rawTo) {
        throw new WfError('WF_BAD_ARGS: wf_ask_agent ask requires targetChildId (target node id or child session id)', 'WF_BAD_ARGS')
      }
      // 目标寻址支持两种形式：子代理会话 id（运行期随机 UUID）或 节点 id（协作块
      // 列出的成员 id —— 组成员稳定、彼此可知的寻址）。解析后统一以子代理会话 id
      // 记账；目标即使已结束/冷态仍在 childIndex（仅随 run 生命周期清理），投递缝
      // 会以 followup 冷恢复直接唤醒，无需目标保持运行中。
      // 注意：节点 id 寻址经 childByNode 恒解析到该节点的**当前**子代理（配置签名
      // 变化重建后指向新 child）；已退役的旧 child 按会话 id 精确寻址会被下方明确拒绝，
      // 其自身发起的 ask 也因 metaFrom 的 retired 校验被拒——旧配置的成员不再参与协作。
      let to = rawTo
      let metaTo = this.childIndex.get(rawTo)
      if (!metaTo || metaTo.sessionId !== run.snapshot.sessionId || metaTo.flowId !== run.snapshot.flowId) {
        const byNode = this.childForNode(run, rawTo)
        if (!byNode) {
          // P2-3：按情形给出可行动指引，让成员可自助纠错而非求助父代理。
          throw new WfError(`WF_ASK_TARGET_UNKNOWN: ${await this.targetUnknownHint(run, from, metaFrom, rawTo)}`, 'WF_ASK_TARGET_UNKNOWN')
        }
        to = byNode.childId
        metaTo = byNode.meta
      }
      // 目标是已退役 child（按子代理会话 id 精确寻址到被替换的旧子代理）：拒绝投递。
      // 它与承载同一 nodeId 的新子代理不是同一执行者，把协作消息投给旧会话会让回复
      // 挂到错误回合（旧 child 的产出/事件已不参与节点结论）。可行动指引用节点 id 寻址。
      if (metaTo.retired === true) {
        throw new WfError(
          `WF_ASK_TARGET_UNKNOWN: the target child was replaced by an updated configuration (node ${metaTo.nodeId}); address the current child by its node id "${metaTo.nodeId}"`,
          'WF_ASK_TARGET_UNKNOWN',
        )
      }
      if (to === from) throw new WfError('WF_BAD_ARGS: cannot send a collaboration message to yourself', 'WF_BAD_ARGS')
      const message = String(args?.message ?? '').trim()
      if (!message) throw new WfError('WF_BAD_ARGS: wf_ask_agent ask requires message', 'WF_BAD_ARGS')
      const ttlMs = Math.max(1, this.deps.config.wfAskAgentTtlMs)
      const askId = this.deps.uuid?.() ?? randomUUID()
      const pending: PendingAsk = {
        askId,
        from,
        to,
        fromNodeId: metaFrom.nodeId,
        toNodeId: metaTo.nodeId,
        message: truncateText(message, ASK_MESSAGE_LIMIT),
        ttlMs,
        expiresAt: this.now() + ttlMs,
      }
      run.asks.set(askId, pending)
      this.auditAsk(pending, 'ask', `from=${from}(${metaFrom.nodeId}) to=${to}(${metaTo.nodeId})`)
      try {
        await delivery.deliver({
          sessionId: run.snapshot.sessionId,
          to,
          message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildAskText(pending), from),
          signal: callerSignal ?? run.controller.signal,
        })
        this.auditAsk(pending, 'deliver', `to=${to}`)
      } catch (error) {
        // 投递失败：撤销登记（避免留下永不投递的待回复记录），业务失败显式上抛。
        run.asks.delete(askId)
        this.auditAsk(pending, 'deliver-failed', messageOf(error))
        throw new WfError(`WF_DELIVERY_FAILED: collaboration message delivery failed: ${messageOf(error)}`, 'WF_DELIVERY_FAILED')
      }
      run.lastActiveAt = this.now()
      return { cmd: 'ask', askId, from, to }
    }

    // ---- reply：目标答复，反向投递回复到发起者 ----
    if (!caller.isChild) {
      throw new WfError('WF_NOT_CHILD: wf_ask_agent reply is available to child agents only', 'WF_NOT_CHILD')
    }
    const askId = String(args?.askId ?? '').trim()
    if (!askId) throw new WfError('WF_BAD_ARGS: wf_ask_agent reply requires askId', 'WF_BAD_ARGS')
    const pending = run.asks.get(askId)
    if (!pending) throw new WfError('WF_ASK_NOT_FOUND: no such collaboration message, or it has already ended', 'WF_ASK_NOT_FOUND')
    if (pending.to !== childId) throw new WfError('WF_ASK_MISMATCH: only the message target may reply to this collaboration message', 'WF_ASK_MISMATCH')
    const target = String(args?.targetChildId ?? '').trim()
    // 发起者可用「子代理会话 id」或「节点 id」任一形式回复（ask 消息文本中两值均含）
    if (target && target !== pending.from && target !== pending.fromNodeId) {
      throw new WfError('WF_ASK_MISMATCH: the reply target does not match the original asker', 'WF_ASK_MISMATCH')
    }
    const message = String(args?.message ?? '').trim()
    if (!message) throw new WfError('WF_BAD_ARGS: wf_ask_agent reply requires message', 'WF_BAD_ARGS')
    this.auditAsk(pending, 'reply', `from=${childId}`)
    try {
      await delivery.deliver({
        sessionId: run.snapshot.sessionId,
        to: pending.from,
        message: coordinatorMessage(this.deps.uuid?.() ?? randomUUID(), buildReplyText(pending, message), childId),
        signal: callerSignal ?? run.controller.signal,
      })
      this.auditAsk(pending, 'reply-deliver', `to=${pending.from}`)
    } catch (error) {
      // 回复未送达：保留登记，允许回复方重试；业务失败显式上抛。
      this.auditAsk(pending, 'reply-deliver-failed', messageOf(error))
      throw new WfError(`WF_DELIVERY_FAILED: collaboration reply delivery failed: ${messageOf(error)}`, 'WF_DELIVERY_FAILED')
    }
    // 回复已送达才释放登记：既允许送达失败后重试，又不再接受该 askId 的重复回复。
    run.asks.delete(askId)
    run.lastActiveAt = this.now()
    return { cmd: 'reply', askId, from: childId, to: pending.from }
  }

  /**
   * TTL 惰性清理过期待回复登记（无定时器；ask 不挂起故无可裁决的受体）。
   * 到期记录静默移除：其 askId 不再接受 reply，审计由宿主日志承载。
   */
  private sweepExpiredAsks(entry: RunEntry): void {
    const now = this.now()
    for (const [askId, pending] of entry.asks) {
      if (pending.expiresAt > now) continue
      entry.asks.delete(askId)
      this.log().info(`[visual-workflow] wf_ask_agent audit: askId=${askId} ttl-expired ttlMs=${pending.ttlMs}`)
    }
  }

  /** 写协作通信审计日志（越权校验的可追溯性）：只落宿主日志，不在内存驻留审计链。 */
  private auditAsk(pending: PendingAsk, event: string, detail: string): void {
    this.log().info(`[visual-workflow] wf_ask_agent audit: askId=${pending.askId} ${event}${detail ? ` ${detail}` : ''}`)
  }

}
