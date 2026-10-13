// src/host/orchestrator/runtime-observe.ts
//
// 编排运行时观察回写层（RuntimeObserve extends RuntimeComm）：subagent/end
// 事件回写节点状态（ok/fail/react-capped）、唤醒 wait 阻塞与协作组聚合。
// 方法体逐字移动。

import type { WorkflowDocument } from '../shared/graph-model.js'
import { memberGroupId, nodeById } from '../graph/index.js'
import { failureOf, lastAssistantText, setNodeStatus } from './snapshot.js'
import { SUBAGENT_END_RETRY_DELAY_MS, SUBAGENT_END_RETRY_MAX } from './seams.js'
import type { ChildMeta } from "./seams.js"
import type { RunEntry, SubagentEndInfo } from './run-entry.js'
import { RuntimeComm } from './runtime-comm.js'
import { verifyNodeArtifacts } from './execution-inputs.js'

export abstract class RuntimeObserve extends RuntimeComm {
  /** 仅接纳宿主已识别的 Workflow child，不把官方 epoch ID 当 Workflow runId。 */
  handleSubagentStart(info: Pick<SubagentEndInfo, "id" | "runId">): void {
    if (this.disposed || typeof info.id !== "string" || typeof info.runId !== "string" || !info.runId) return
    if (this.childIndex.get(info.id)?.retired) return
    this.childEpochs.set(info.id, info.runId)
  }

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
  async handleSubagentEnd(info: SubagentEndInfo, tries = 0): Promise<void> {
    const childId = String(info?.id ?? '')
    if (!childId) return
    const meta = this.childIndex.get(childId)
    // childIndex 尚未登记（极快完成/同步失败的子代理事件先于登记到达）：
    // 不能静默丢弃——否则 wait:true 等待器永久挂起、inflight 残留。有界重试等待登记。
    if (!meta) {
      this.deferSubagentEnd(info, tries)
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
    if (meta.purpose === "task-review") {
      const entry = this.runs.get(meta.runId ?? "")
      if (!entry || entry.controller.signal.aborted || !["running", "paused"].includes(entry.snapshot.status)) return
      const review = entry.snapshot.nodes.find((node) => node.nodeId === meta.nodeId)?.taskAcceptance?.review
      if (review?.state === "requested") { this.deferSubagentEnd(info, tries); return }
      await this.handleDagReviewEnd(entry, meta, info)
      return
    }
    for (const entry of this.runs.values()) {
      const s = entry.snapshot
      if (s.sessionId !== meta.sessionId || s.flowId !== meta.flowId) continue
      const current = s.nodes.find((node) => node.nodeId === meta.nodeId)
      if (s.executionMode === "dag" && entry.dispatching?.has(meta.nodeId) && !entry.inflight.has(childId)) {
        this.deferSubagentEnd(info, tries)
        return
      }
      if (s.executionMode === "dag" && current?.status !== "running") return
      if (current?.status === "running" && current.childId === undefined && entry.dispatching?.has(meta.nodeId)) {
        // 冷恢复的同 ID 已有旧登记，新 epoch 可能在本次投递返回前结束。
        this.deferSubagentEnd(info, tries)
        return
      }
      if (typeof info.runId === "string" && meta.hostEpochId && info.runId !== meta.hostEpochId) return
      if (!this.currentChild(entry, childId, meta)) continue
      if (s.status !== 'running' && s.status !== 'paused') return
      const stopReason = String(info?.stopReason ?? '')
      // max-tokens = 模型输出被硬截断（内容不完整），不能视为成功（Bug 19）；
      // 仅 completed 才算节点成功；ReAct 软截停由 consumeReactCapped 另判 react-capped。
      let completed = stopReason === 'completed'
      let artifactFailure
      let needsReview = false
      if (completed) {
        try {
          const flow = await this.currentResolvedFlow(entry)
          const node = nodeById(flow, meta.nodeId)
          if (!this.currentChild(entry, childId, meta)) return
          if (node?.kind === "agent") {
            needsReview = s.nodes.find((record) => record.nodeId === meta.nodeId)?.attemptHistory?.at(-1)?.taskReviewRequired === true
            // 检查期间可能发生重试/退役；先对捕获的代际副本验证，提交前再核对。
            const verification = structuredClone(s)
            await verifyNodeArtifacts(node, verification, this.now())
            if (!this.currentChild(entry, childId, meta)) return
            const record = s.nodes.find((n) => n.nodeId === meta.nodeId)
            const artifacts = verification.nodes.find((n) => n.nodeId === meta.nodeId)?.artifacts
            if (record && artifacts) record.artifacts = artifacts
          }
        } catch (error) {
          completed = false
          artifactFailure = failureOf(error, "run_finish", "WF_OUTPUT_FILE_MISSING", this.now())
        }
      }
      if (!this.currentChild(entry, childId, meta)) return
      if (s.status !== 'running' && s.status !== 'paused') return
      // 完整产出先取全量（limit=0 不截断），再由 setNodeStatus 按两套口径各自截断：
      //   - nodes[].output        ← config.outputFullLimit（默认 100KB；断点回填与下游 ctx 注入的读取源）
      //   - nodes[].outputSummary ← OUTPUT_SUMMARY_LIMIT（6000 字；仅供界面展示）
      // 历史 BUG（2026.09 修复）：此处曾用 OUTPUT_SUMMARY_LIMIT 先截断再交给 setNodeStatus，
      // 导致 outputFullLimit 形同虚设（完整产出实际卡在 6000 字），下游节点与断点续跑
      // 都只能拿到被砍掉的产出。
      const outputText = lastAssistantText(info?.lastAssistantMessage, 0)
      // 软截停（护栏）：触达 ReAct 上限仍正常产出——标记 react-capped（非失败）
      const reactCapped = this.deps.runner.consumeReactCapped?.(childId) === true
      // P0-1：协作组成员回合结束 ≠ 终态完成——它在协作组内仍可被 wf_ask_agent 唤醒，
      // 落「armed/待命」中间态（显示为「等待」），避免被误判为终态 ok、组卡片提前 ok。
      const inGroup = completed && !reactCapped && (await this.isGroupMemberOf(entry, meta.nodeId))
      if (!this.currentChild(entry, childId, meta)) return
      entry.inflight.delete(childId)
      entry.lastActiveAt = this.now()
      const finalStatus: 'ok' | 'armed' | 'react-capped' | 'fail' = completed
        ? (reactCapped ? 'react-capped' : (inGroup ? 'armed' : 'ok'))
        : 'fail'
      setNodeStatus(s, meta.nodeId, finalStatus, {
        output: outputText || '(子代理已完成，但无可汇总文本)',
        outputFullLimit: this.deps.config.outputFullLimit,
        now: this.now(),
        stopReason,
        recordTurn: true,
        childId,
        ...(completed ? {} : { failure: artifactFailure ?? s.nodes.find((node) => node.nodeId === meta.nodeId)?.failure ?? failureOf({ message: `子代理执行结束：${stopReason || "unknown"}` }, "child_execute", "WF_CHILD_EXECUTION_FAILED", this.now()) }),
      })
      const reviewed = s.nodes.find((record) => record.nodeId === meta.nodeId)
      if (completed && needsReview && reviewed) {
        reviewed.taskAcceptance = { status: "pending" }
        const attempt = reviewed.attemptHistory?.at(-1)
        if (attempt) attempt.taskAcceptance = { status: "pending" }
      }
      // 协作组聚合：成员产出一轮后若组内全部成员均已产出且该组无挂起 ask → 组卡片记为 ok
      // （「组内全部 ok -> 组卡片记为 ok」；只做回显，不干预父代理调度）
      if (completed) await this.markGroupOkIfComplete(entry, meta.nodeId)
      await this.persistWarn(entry)
      const settledNode = s.nodes.find((node) => node.nodeId === meta.nodeId)
      this.log().info(JSON.stringify({ runId: s.id, nodeId: meta.nodeId, childId, attempt: settledNode?.attempts, phase: "settled", status: finalStatus, stopReason, taskAcceptance: settledNode?.taskAcceptance?.status, errorCode: settledNode?.failure?.code }))
      // 唤醒阻塞等待（wait:true；与 subagent/end 共用同一完成通道）。armed 视同完成。
      const waitKey = `${s.id}:${meta.nodeId}`
      const waiter = entry.waiters.get(waitKey)
      if (waiter) {
        entry.waiters.delete(waitKey)
        waiter.resolve({ nodeId: meta.nodeId, status: finalStatus === 'fail' ? 'fail' : 'ok', childId, output: outputText,
          ...(s.harnessContext ? { runId: s.id, attempt: settledNode?.attempts, taskAcceptance: settledNode?.taskAcceptance?.status } : {}) })
      }
      if (s.executionMode === "dag") {
        try { await this.reviewDagNode(entry, meta.nodeId) } catch (error) {
          const failure = failureOf(error, "run_finish", "WF_DAG_REVIEW_PERSIST_FAILED", this.now())
          const task = s.nodes.find((node) => node.nodeId === meta.nodeId)?.taskAcceptance
          if (task?.review) { task.status = "pending"; task.reason = failure.message; task.review.state = "blocked"; task.review.errorCode = failure.code }
          if (s.status === "running") {
            s.status = "paused"
            s.summary = `${failure.code}：验收持久化失败，未派发下游；请通过工作台处理`
            await this.persistWarn(entry)
          }
        }
        await this.advanceDag(entry)
      }
      return
    }
  }

  private currentChild(entry: RunEntry, childId: string, meta: ChildMeta): boolean {
    if (this.childIndex.get(childId) !== meta || meta.retired || (meta.runId && entry.snapshot.id !== meta.runId)) return false
    const node = entry.snapshot.nodes.find((record) => record.nodeId === meta.nodeId)
    if (entry.snapshot.executionMode === "dag" && node?.status !== "running") return false
    // 旧登记缺省代际仍兼容；新的代际必须三元组一致。
    return !!node && (meta.attempt === undefined || node.attempts === meta.attempt)
      && (node.childId === undefined ? meta.runId === undefined : node.childId === childId)
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
      if (this.childIndex.has(childId)) void this.handleSubagentEnd(info, tries + 1)
      else this.deferSubagentEnd(info, tries + 1)
    }, SUBAGENT_END_RETRY_DELAY_MS)
  }

  /**
   * 协作组聚合：某成员产出一轮后，若其所属协作组全部成员均已「产出一轮」
   * （armed/ok/react-capped），且该组当前无待回复 ask，把组卡片标记为 ok
   * （只影响运行回显，不干预父代理调度）。组卡片单向推进：仅 pending → ok；
   * 成员后续重试/失败不回退组卡片。流程读取失败时跳过聚合（下一次成员完成事件重试）。
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
      // 组完成 = 全部成员已产出一轮（armed/ok/react-capped）且该组无待回复 ask（P0-1 建议 2）
      const allProduced = (group.data.memberIds ?? []).every((id) => {
        const record = snapshot.nodes.find((n) => n.nodeId === id)
        return record !== undefined && (record.status === 'armed' || record.status === 'ok' || record.status === 'react-capped')
      })
      if (!allProduced) continue
      const memberSet = new Set(group.data.memberIds ?? [])
      // 非阻塞协议下登记即「已发出但尚无回复」；有其一则不判组完成。
      const groupHasPendingAsk = Array.from(entry.asks.values()).some(
        (ask) => ask.toNodeId === group.id || memberSet.has(ask.toNodeId),
      )
      if (groupHasPendingAsk) continue
      const current = snapshot.nodes.find((n) => n.nodeId === group.id)
      // 组卡片由 wf_run_node(groupId) 置为 running，故 pending 与 running 都是可收敛状态；
      // 组卡片单向推进（running/pending → ok），成员后续重试/失败不回退组卡片。
      if (current && (current.status === 'pending' || current.status === 'running')) {
        setNodeStatus(snapshot, group.id, 'ok', { output: '（协作组）全部成员已完成', now: this.now() })
      }
    }
  }

  /**
   * 判断某 agent 节点是否属于某协作组（P0-1：组成员回合结束落 armed 而非 ok）。
   * 流程读取失败时保守返回 false（不阻断，落 ok，保留旧行为）。
   */
  private async isGroupMemberOf(entry: RunEntry, nodeId: string): Promise<boolean> {
    try {
      const flow = await this.currentResolvedFlow(entry)
      return memberGroupId(flow, nodeId) !== null
    } catch {
      return false
    }
  }
}
