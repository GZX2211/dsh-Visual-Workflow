// src/host/orchestrator/runtime-comm.ts
//
// 编排运行时通信层（RuntimeComm extends RuntimeExecute）：wf_send_message——
// 向本 run 的另一成员投递一条单向持久消息（投递即返回，不等待回复）。
//
// 为什么单独成层：寻址解析（nodeId → 子代理会话 / 官方成员名）、归属校验与投递状态
// 判定都是「跨代理通信」的运行事实，与节点执行（RuntimeExecute）职责不同。

import { randomUUID } from 'node:crypto'
import { isGroupMember } from '../graph/index.js'
import { teammateNameOf } from '../team/index.js'
import { labelOf } from './graph-facts.js'
import {
  PARENT_TARGET,
  SEND_MESSAGE_LIMIT,
  buildSendMessageText,
  coordinatorMessage,
  type SendMessageArgs,
  type SendMessageDelivery,
  type SendMessageResult,
  type SendMessageStatus,
} from './send-message-protocol.js'
import { truncateText } from './snapshot.js'
import { WfError, messageOf } from './errors.js'
import type { WorkflowDocument } from '../shared/graph-model.js'
import type { RunEntry } from './run-entry.js'
import { type CallerInfo, type ChildMeta } from './seams.js'
import { RuntimeExecute } from './runtime-execute.js'

export class RuntimeComm extends RuntimeExecute {
  /**
   * wf_send_message：投递一条单向持久消息，随即返回投递结果（不等待回复）。
   *
   * 寻址面只有两种形态（用户裁决 2026-10）：
   *   - `parent`：本会话 root（父代理）。调用方即父代理时拒绝（不可自投）；
   *   - `<nodeId>`：本 run 的节点成员。命中 childIndex 后按「是否 Team 成员 + 官方 Team
   *     是否可用」选择投递通道：成员走官方 Team 服务（成员名寻址），否则走普通子代理
   *     （在线插队 / 离线冷恢复）。
   *
   * 校验（越权拒绝，全程写审计）：运行锁 + 发送方必须是本 run 当前在编节点
   * （父代理即会话 root，子代理经 childIndex 归属校验并拒绝已退役 child）+ 目标必须
   * 属于本 run 且已启动。**不做 ACL**：可通信清单只告知不授权（可见面即权限面）。
   */
  async wfSendMessage(
    caller: CallerInfo,
    childId: string,
    args: SendMessageArgs,
    delivery: SendMessageDelivery,
    callerSignal?: AbortSignal,
  ): Promise<SendMessageResult> {
    const target = String(args?.target ?? '').trim()
    if (!target) throw new WfError('WF_SEND_BAD_ARGS: wf_send_message requires target ("parent" or a member node id)', 'WF_SEND_BAD_ARGS')
    const message = String(args?.message ?? '').trim()
    if (!message) throw new WfError('WF_SEND_BAD_ARGS: wf_send_message requires message', 'WF_SEND_BAD_ARGS')

    const run = this.requireRunningRun(caller)
    const sessionId = run.snapshot.sessionId
    const signal = callerSignal ?? run.controller.signal
    const sender = await this.senderOf(run, caller, childId)
    const text = truncateText(message, SEND_MESSAGE_LIMIT)
    // 消息正文在每次投递时现算：正文含发送方身份，与投递对象、run 内时钟无关。
    const buildMessage = () =>
      coordinatorMessage(
        this.deps.uuid?.() ?? randomUUID(),
        buildSendMessageText({ label: sender.label, id: sender.id }, text),
        sender.sessionId,
      )

    // ---- 目标：父代理（别名寻址） ----
    if (target === PARENT_TARGET) {
      if (!caller.isChild) throw new WfError('WF_SEND_BAD_ARGS: target "parent" is the caller itself', 'WF_SEND_BAD_ARGS')
      const status = await this.deliverSending(run, sender.id, target, PARENT_TARGET, () =>
        delivery.deliverToParent({ sessionId, message: buildMessage(), signal }))
      return { target, resolved: PARENT_TARGET, status }
    }

    // ---- 目标：本 run 的节点成员 ----
    const byNode = this.childForNode(run, target)
    if (!byNode || byNode.meta.retired === true) {
      throw new WfError(`WF_SEND_TARGET_UNKNOWN: ${await this.targetUnknownText(run, target)}`, 'WF_SEND_TARGET_UNKNOWN')
    }
    if (caller.isChild && sender.nodeId === target) {
      throw new WfError('WF_SEND_BAD_ARGS: cannot send a message to yourself', 'WF_SEND_BAD_ARGS')
    }

    // 通道选择：组内成员 + 官方 Team 可用 → 官方成员名投递；否则普通子代理投递。
    const flow = await this.currentResolvedFlow(run)
    if (isGroupMember(flow, target) && this.deps.runner.teamAvailable?.(sessionId) === true) {
      const memberStatus = this.deps.runner.teamMemberStatusOf?.(sessionId, target) ?? null
      if (memberStatus === 'failed') {
        throw new WfError(`WF_SEND_TARGET_UNKNOWN: 成员 ${target} 创建失败，你不可以对其投递消息`, 'WF_SEND_TARGET_UNKNOWN')
      }
      // 官方成员状态 → 投递状态（running 已送达 / provisioning 排队 / inactive 冷恢复）。
      const memberSendStatus: SendMessageStatus = memberStatus === 'provisioning'
        ? 'queued'
        : memberStatus === 'inactive'
          ? 'resumed'
          : 'delivered'
      const memberName = teammateNameOf(target)
      const status = await this.deliverSending(run, sender.id, target, memberName, async () => {
        await delivery.deliverToTeammate({ sessionId, memberName, message: buildMessage(), signal })
        return memberSendStatus
      })
      return { target, resolved: memberName, status }
    }

    const status = await this.deliverSending(run, sender.id, target, byNode.childId, () =>
      delivery.deliverToChild({ sessionId, childId: byNode.childId, message: buildMessage(), signal }))
    return { target, resolved: byNode.childId, status }
  }

  /**
   * 发送方身份（父代理 = 会话 root；子代理 = 本 run 当前在编节点子代理）。
   *
   * 拒绝的两种情形都是「不是本 run 的当前执行者」：陌生子代理（冒名）与已退役 child
   * （配置重建后被替换的旧子代理——它仍可能在收尾，但消息会挂到错误回合）。
   */
  private async senderOf(
    run: RunEntry,
    caller: CallerInfo,
    childId: string,
  ): Promise<{ label: string; id: string; sessionId: string; nodeId?: string }> {
    if (!caller.isChild) return { label: '父代理', id: PARENT_TARGET, sessionId: run.snapshot.sessionId }
    const meta = childId ? this.childIndex.get(childId) : null
    if (!meta || meta.sessionId !== run.snapshot.sessionId || meta.flowId !== run.snapshot.flowId) {
      throw new WfError('WF_SEND_BAD_ARGS: the caller is not a node child of the running workflow', 'WF_SEND_BAD_ARGS')
    }
    if (meta.retired === true) {
      throw new WfError(
        'WF_SEND_BAD_ARGS: this node child was replaced by an updated configuration and can no longer send messages',
        'WF_SEND_BAD_ARGS',
      )
    }
    return { label: await this.nodeLabelOf(run, meta.nodeId), id: meta.nodeId, sessionId: childId, nodeId: meta.nodeId }
  }

  /** 节点人类可读名称（读不到画布时退回 nodeId）。 */
  private async nodeLabelOf(run: RunEntry, nodeId: string): Promise<string> {
    try {
      const flow = await this.currentResolvedFlow(run)
      const node = (flow.nodes ?? []).find((item) => item.id === nodeId)
      return node ? labelOf(node) : nodeId
    } catch {
      return nodeId
    }
  }

  /**
   * WF_SEND_TARGET_UNKNOWN 的可行动提示（按情形区分）。
   *
   * 措辞红线（用户裁决 2026-10）：**不得引导子代理使用 wf_run_node**——子代理既没有该
   * 工具也不应知道它。目标未启动时就直说「该成员未启动，你不可以对其投递消息」。
   */
  private async targetUnknownText(run: RunEntry, target: string): Promise<string> {
    let flow: WorkflowDocument
    try {
      flow = await this.currentResolvedFlow(run)
    } catch {
      return `目标 ${target} 不是本次运行的成员，请从可通信清单中选择`
    }
    const isFlowNode = (flow.nodes ?? []).some((node) => node.id === target)
    return isFlowNode
      ? '该成员未启动，你不可以对其投递消息'
      : `目标 ${target} 不是本次运行的成员，请从可通信清单中选择`
  }

  /** 投递并写审计：成功返回投递状态；失败显式上抛 WF_SEND_DELIVERY_FAILED（可重试）。 */
  private async deliverSending(
    run: RunEntry,
    fromId: string,
    target: string,
    resolved: string,
    deliver: () => Promise<SendMessageStatus>,
  ): Promise<SendMessageStatus> {
    try {
      const status = await deliver()
      this.log().info(`[visual-workflow] wf_send_message audit: caller=${fromId} target=${target} resolved=${resolved} status=${status}`)
      run.lastActiveAt = this.now()
      return status
    } catch (error) {
      this.log().info(
        `[visual-workflow] wf_send_message audit: caller=${fromId} target=${target} resolved=${resolved} delivery-failed ${messageOf(error)}`,
      )
      throw new WfError(`WF_SEND_DELIVERY_FAILED: message delivery failed: ${messageOf(error)}`, 'WF_SEND_DELIVERY_FAILED')
    }
  }

  /** 校验调用者会话存在运行且 running（父代理与子代理调用方共用）。 */
  private requireRunningRun(caller: CallerInfo): RunEntry {
    const sessionId = caller.sessionId
    if (!sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session', 'WF_BAD_CALLER')
    const run = this.activeRunForSession(sessionId)
    if (!run) throw new WfError('WF_NO_ACTIVE_RUN: no running orchestration in this session', 'WF_NO_ACTIVE_RUN')
    return run
  }

  /**
   * 节点 id → 本 run 的子代理会话 id 反查（成员稳定寻址，O(1)）。
   * 借助 childByNode（nodeId → childId）反向索引命中；命中后仍需按
   * sessionId/flowId 归属校验（同一 nodeId 可能被不同 run/会话登记）。
   * 目标未启动/不属于本 run 返回 null（调用方按 WF_SEND_TARGET_UNKNOWN 处理）。
   */
  private childForNode(run: RunEntry, nodeId: string): { childId: string; meta: ChildMeta } | null {
    const childId = this.childByNode.get(nodeId)
    if (!childId) return null
    const meta = this.childIndex.get(childId)
    if (!meta) return null
    if (meta.nodeId !== nodeId || meta.sessionId !== run.snapshot.sessionId || meta.flowId !== run.snapshot.flowId) return null
    return { childId, meta }
  }
}
