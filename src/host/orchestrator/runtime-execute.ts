// src/host/orchestrator/runtime-execute.ts
//
// 编排运行时节点执行层（RuntimeExecute extends RuntimeLaunch）：wf_run_node
// （异步/暂停门/阻塞三路径）与 wf_finish（父代理收尾，幂等）。方法体逐字移动。
//
// 运行锁降权（用户裁决）：两者的运行上下文获取统一经 ensureActiveRun——本会话停在
// paused/stopped/interrupted 断点时**静默接续**接管（只接管运行事实与锁，不注入编排
// 指令、不要求父代理空闲），不再以 WF_PAUSED/WF_STOPPED 阻断，也不再需要人工点「运行」。

import { WF_RUN_NODE_WAIT } from '../shared/protocol.js'
import { nodeById } from '../graph/index.js'
import { DEFAULT_SYSTEM_LANGUAGE } from '../system-language.js'
import { collabPromptOf, labelOf } from './graph-facts.js'
import { effectiveReactLimitOf, effectiveRetryLimitOf, effectiveThinkingOf } from './node-params.js'
import { buildNodeBlocks } from './task-blocks.js'
import { WfError } from './errors.js'
import { createWaiter, type FinishArgs, type FinishResult, type RunEntry, type RunNodeArgs, type RunNodeResult, type Waiter } from './run-entry.js'
import { setNodeStatus, terminalizeNodes } from './snapshot.js'
import { GLOBAL_RUN_CALL_LIMIT, type CallerInfo, type GroupMemberPlan, type GroupStartResult } from './seams.js'
import { RuntimeLaunch } from './runtime-launch.js'
import type { GroupNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'

export class RuntimeExecute extends RuntimeLaunch {
  // ---- wf_run_node ----------------------------------------------------------

  /** 校验调用者为「当前会话根 Agent」并取可直接执行节点的激活运行（必要时静默接续）。 */
  private async requireRootRun(caller: CallerInfo, toolName: string): Promise<RunEntry> {
    if (caller.isChild) throw new WfError(`WF_NOT_ROOT: a child agent cannot call ${toolName}; only the session main agent may orchestrate`, 'WF_NOT_ROOT')
    const sessionId = caller.sessionId
    if (!sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session', 'WF_BAD_CALLER')
    // 运行锁降权 + 静默接续（用户裁决）：本会话存在暂停/已停止/已中断的断点时不报错，
    // 而是接管运行事实与锁后继续（不注入编排指令）——父代理在自身回合内自行恢复，
    // 「继续」由父代理按语义触发，无需人工回工作台点「运行」。
    const run = await this.ensureActiveRun(sessionId)
    if (!run) {
      // 本会话既无激活运行、也无任何可恢复断点：确实是「从未启动过运行」。
      // 此时插件拿不到任何 workflow 实例依据（无断点即无 flowId），只能给出可行动提示。
      throw new WfError('WF_NO_ACTIVE_RUN: no active orchestration and no resumable checkpoint for this session; start a run on the canvas first', 'WF_NO_ACTIVE_RUN')
    }
    if (run.snapshot.status !== 'running') {
      // 静默接续未能生效（例如工作流已不完整）——给出终态文案，不静默
      throw new WfError(`WF_STOPPED: the run can no longer execute (status: ${run.snapshot.status})`, 'WF_STOPPED')
    }
    return run
  }

  /**
   * wf_run_node：启动一个角色节点的子代理。
   *   - 默认异步（模式一）：立即返回 { nodeId, status:'started', childId }；
   *   - wait:true 阻塞（模式二）：等待该节点子代理完成，返回 { nodeId, status:'ok'|'fail', childId, output }；
   *   - 暂停节点：触发暂停门（run=paused + 断点持久化 resumeFrom=暂停节点，锁保留）；
   *   - 本会话停在 paused/stopped/interrupted 断点时：**先静默接续**（新 run 接管锁，
   *     不注入编排指令）再执行本次调度——父代理在自己的回合内即可自行恢复，
   *     人工点「运行」不再是必需动作。
   */
  async wfRunNode(
    caller: CallerInfo,
    args: RunNodeArgs,
    callerSignal?: AbortSignal,
    options: { expectedMode?: 'mode1' | 'mode2' } = {},
  ): Promise<RunNodeResult> {
    const run = await this.requireRootRun(caller, options?.expectedMode === 'mode2' ? WF_RUN_NODE_WAIT : 'wf_run_node')
    // 模式与工具一一对应：wf_run_node 仅流程编排模式，wf_run_node_wait 仅API服务模式
    if (options?.expectedMode && run.snapshot.mode !== options.expectedMode) {
      throw new WfError(
        options.expectedMode === 'mode2'
          ? 'WF_MODE_MISMATCH: wf_run_node_wait only works in mode2 (API service runs)'
          : 'WF_MODE_MISMATCH: wf_run_node only works in mode1 (flow orchestration runs)',
        'WF_MODE_MISMATCH',
      )
    }
    const nodeId = String(args?.nodeId ?? '').trim()
    if (!nodeId) throw new WfError('WF_BAD_ARGS: wf_run_node requires nodeId', 'WF_BAD_ARGS')
    if (run.controller.signal.aborted) throw new WfError('WF_CANCELLED: the run has been stopped', 'WF_CANCELLED')

    // 执行者模式：父代理开始调度（首次 wf_run_node 成功前）→ 自身节点任务视为完成，
    // 快照标记 ok 并把父代理最近产出回写（下游 ctx 连线可注入该产出）
    this.markParentExecutorDone(run)

    // 双向同步①：每次调度前重读最新工作流快照（运行中画布调整即时生效）
    const flow = await this.currentResolvedFlow(run)

    // 虚拟节点解析为主节点（共享同一子代理执行实例）
    let node = nodeById(flow, nodeId)
    if (!node) throw new WfError(`WF_NODE_MISSING: node not found or removed from the canvas: ${nodeId}`, 'WF_NODE_MISSING')
    if (node.kind === 'proxy') {
      const source = nodeById(flow, node.proxySourceId)
      if (!source) throw new WfError(`WF_NODE_MISSING: the proxy node's source node is missing: ${node.proxySourceId}`, 'WF_NODE_MISSING')
      node = source
    }

    // 暂停门：暂停节点不派生子代理，run 置 paused + 断点持久化
    if (node.kind === 'pause') {
      run.callCount += 1
      if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
        throw new WfError(`WF_GLOBAL_LIMIT: orchestration exceeded the global call limit (${GLOBAL_RUN_CALL_LIMIT} wf_run_node calls)`, 'WF_GLOBAL_LIMIT')
      }
      run.lastActiveAt = this.now()
      setNodeStatus(run.snapshot, nodeId, 'ok', { attempts: 1, output: '(pause gate) run paused', now: this.now() })
      run.snapshot.status = 'paused'
      run.snapshot.resumeFromNodeId = nodeId
      await this.persistWarn(run)
      return { nodeId, status: 'paused' }
    }

    // 协作组：整组交给官方 Agent Team（成员数量与成员参数由画布决定）。
    // 仅模式一支持：模式二的阻塞等待语义与团队异步协作不匹配，保持既有「非 agent 节点」拒绝。
    if (node.kind === 'group') {
      if (run.snapshot.mode !== 'mode1') {
        throw new WfError(
          `WF_NODE_KIND: wf_run_node_wait does not accept a collaboration-group node; start its member nodes one by one ("${labelOf(node)}")`,
          'WF_NODE_KIND',
        )
      }
      return await this.runGroupNode(run, flow, node, args)
    }

    if (node.kind !== 'agent') {
      throw new WfError(`WF_NODE_KIND: wf_run_node only accepts an agent node; "${labelOf(node)}" is ${node.kind}`, 'WF_NODE_KIND')
    }
    // 虚拟节点解析后一切以主节点 key 记账（共享同一子代理执行实例与快照记录）
    const resolvedNodeId = node.id

    // 硬护栏：全局调用上限 + 单节点重试上限
    run.callCount += 1
    if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
      throw new WfError(`WF_GLOBAL_LIMIT: orchestration exceeded the global call limit (${GLOBAL_RUN_CALL_LIMIT} wf_run_node calls); stopped automatically`, 'WF_GLOBAL_LIMIT')
    }
    const attempt = (run.attempts.get(resolvedNodeId) ?? 0) + 1
    run.attempts.set(resolvedNodeId, attempt)
    const effectiveRetryLimit = effectiveRetryLimitOf(node, args, this.deps.config.retryLimitDefault)
    if (attempt > effectiveRetryLimit + 1) {
      throw new WfError(`WF_RETRY_LIMIT: node "${labelOf(node)}" exceeded its retry limit (at most ${effectiveRetryLimit} retries)`, 'WF_RETRY_LIMIT')
    }
    const effectiveReactLimit = effectiveReactLimitOf(node, args, this.deps.config.reactIterationLimitDefault)
    const thinking = effectiveThinkingOf(node, args)
    run.lastActiveAt = this.now()

    // 启动子代理之前，为其 db-in 所连本地库预建索引：把构建耗时吸收到启动阶段，
    // 避免子代理首次检索才构建（延迟/「无索引」间歇）。best-effort：构建缺失/失败
    // 不阻塞节点启动，交由 wf_db_query(mode=search) 的惰性构建兜底。
    // 能力经依赖缝注入（编排器不反向依赖数据工具域）。
    if (this.deps.dbIndexer) {
      await this.deps.dbIndexer.ensureIndexes(resolvedNodeId, flow)
    }

    setNodeStatus(run.snapshot, resolvedNodeId, 'running', { attempts: attempt, now: this.now() })
    const blocks = buildNodeBlocks({
      flow,
      node,
      snapshot: run.snapshot,
      documentTextLimit: this.deps.config.documentTextLimit,
      systemLanguage: run.snapshot.systemLanguage ?? this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
    })

    // wait:true 阻塞等待器必须先于启动注册（subagent/end 可能在启动返回前到达）
    const waitRequested = args?.wait === true
    const waitKey = `${run.snapshot.id}:${resolvedNodeId}`
    let waiter: Waiter | null = null
    if (waitRequested) {
      if (run.waiters.has(waitKey)) {
        throw new WfError(`节点「${labelOf(node)}」已有阻塞等待中的执行`, 'WF_BUSY')
      }
      waiter = createWaiter()
      run.waiters.set(waitKey, waiter)
    }

    try {
      const { childId, replacedChildId } = await this.deps.runner.startNodeTask({
        sessionId: run.snapshot.sessionId,
        flowId: run.snapshot.flowId,
        mode: run.snapshot.mode,
        node,
        blocks,
        signal: run.controller.signal,
        collabPrompt: collabPromptOf(flow, node.id),
        ...(thinking !== undefined ? { thinking } : {}),
        ...(effectiveReactLimit !== undefined ? { iterationLimit: effectiveReactLimit } : {}),
      })
      // 子代理重建（配置签名变化）：旧 child 已由引擎尽力中断，编排器侧把它的登记
      // **退役**并从 inflight 摘除——不删表项（否则其迟到事件走「未登记」重试路径刷
      // 告警），而是标记 retired 使其 subagent/end 静默丢弃。否则旧配置的产出会经同一
      // nodeId 覆写新子代理正在推进的节点状态（节点状态错位）。
      // 必须同时摘除 inflight：旧 child 被中断后可能不再产生 subagent/end，若留在
      // inflight 会让空闲看护永远认为「仍有子代理在跑」而永不收敛（该节点在途执行者
      // 已由新 child 代表，语义上不需要两个）。
      if (replacedChildId !== undefined) {
        run.inflight.delete(replacedChildId)
        const retired = this.childIndex.get(replacedChildId)
        if (retired) this.childIndex.set(replacedChildId, { ...retired, retired: true })
      }
      run.inflight.add(childId)
      this.childIndex.set(childId, { sessionId: run.snapshot.sessionId, flowId: run.snapshot.flowId, nodeId: resolvedNodeId })
      this.childByNode.set(resolvedNodeId, childId)
      if (!waitRequested) return { nodeId: resolvedNodeId, status: 'started', childId }
    } catch (error) {
      if (waiter) run.waiters.delete(waitKey)
      if (run.snapshot.status === 'running') setNodeStatus(run.snapshot, resolvedNodeId, 'fail', { attempts: attempt, now: this.now() })
      throw error
    }

    // wait 阻塞：等待 subagent/end 唤醒（完成）或运行终止/调用取消（reject）
    const onAbort = (): void => {
      run.waiters.delete(waitKey)
      waiter!.reject(new WfError('WF_CANCELLED: the run has been stopped', 'WF_CANCELLED'))
    }
    if (callerSignal && !callerSignal.aborted) callerSignal.addEventListener('abort', onAbort, { once: true })
    else if (callerSignal?.aborted) onAbort()
    try {
      return await waiter!.promise
    } finally {
      callerSignal?.removeEventListener('abort', onAbort)
    }
  }

  // ---- 协作组（官方 Agent Team） ---------------------------------------------

  /**
   * 协作组节点执行：把整组启动为官方 Agent Team。
   *
   * 语义边界：
   *   - 成员数量与成员级参数（角色提示词/模型/工具白名单）由画布与子代理引擎决定，
   *     本方法只负责解析成员、组装成员任务块、登记事件归属与快照状态；
   *   - 协作过程（消息邮箱、任务板、等待、中断、成员状态）全部由官方机制负责，
   *     本方法不注入任何协作协议文本；
   *   - 官方团队不可用时不擅自启动成员：报可行动错误，指示父代理逐个启动成员节点
   *     （既有语义），避免两条路径同时存在导致成员被启动两次。
   *   - 成员会话是官方 Lead（会话根 Agent）的直接可延续子代理，其 subagent/end 事件
   *     经 childIndex 回写成员节点状态，组卡片由既有聚合逻辑标 ok。
   *
   * @param run - 当前运行条目。
   * @param flow - 最新工作流快照。
   * @param group - 协作组节点。
   * @param args - 工具入参（thinking / iterationLimit / retryLimit 作用于本组）。
   * @returns started 路径结果（含成员清单；一个组对应多个成员会话，故无单一 childId）。
   */
  private async runGroupNode(
    run: RunEntry,
    flow: WorkflowDocument,
    group: GroupNode,
    args: RunNodeArgs,
  ): Promise<RunNodeResult> {
    const sessionId = run.snapshot.sessionId
    const groupId = group.id
    const memberIds = [...new Set(((group.data.memberIds ?? []) as unknown[]).map((id) => String(id ?? '')).filter(Boolean))]
    if (memberIds.length === 0) {
      throw new WfError(`WF_GROUP_EMPTY: collaboration group "${labelOf(group)}" has no members`, 'WF_GROUP_EMPTY')
    }
    if (args?.wait === true) {
      throw new WfError(`WF_GROUP_WAIT_UNSUPPORTED: collaboration group "${labelOf(group)}" does not support a blocking wait; start it asynchronously with wf_run_node`, 'WF_GROUP_WAIT_UNSUPPORTED')
    }
    const runner = this.deps.runner
    const startGroup = runner.startGroupTask
    if (typeof startGroup !== 'function' || runner.teamAvailable?.(sessionId) !== true) {
      throw new WfError(
        `WF_TEAM_UNAVAILABLE: the official Agent Team capability is not available, so collaboration group "${labelOf(group)}" cannot be started as a whole. ` +
        `Start its member nodes one by one with wf_run_node: [${memberIds.join(', ')}].`,
        'WF_TEAM_UNAVAILABLE',
      )
    }

    // 硬护栏与单节点路径同口径（全局调用上限 + 组级尝试计数 + 组级参数覆盖）
    run.callCount += 1
    if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
      throw new WfError(`WF_GLOBAL_LIMIT: orchestration exceeded the global call limit (${GLOBAL_RUN_CALL_LIMIT} wf_run_node calls); stopped automatically`, 'WF_GLOBAL_LIMIT')
    }
    const attempt = (run.attempts.get(groupId) ?? 0) + 1
    run.attempts.set(groupId, attempt)
    const effectiveRetryLimit = effectiveRetryLimitOf(group, args, this.deps.config.retryLimitDefault)
    if (attempt > effectiveRetryLimit + 1) {
      throw new WfError(`WF_RETRY_LIMIT: collaboration group "${labelOf(group)}" exceeded its retry limit (at most ${effectiveRetryLimit} retries)`, 'WF_RETRY_LIMIT')
    }
    const effectiveReactLimit = effectiveReactLimitOf(group, args, this.deps.config.reactIterationLimitDefault)
    const thinking = effectiveThinkingOf(group, args)
    run.lastActiveAt = this.now()

    // 成员解析与护栏校验：整组启动的唯一前置（在任何状态写入之前拒绝非法组）。
    // 已校验的成员节点一并收窄并收集，供下方计划循环直接复用（不二次查找、不重复守卫）。
    const members: Array<{ id: string; node: RoleNode }> = []
    for (const memberId of memberIds) {
      const member = nodeById(flow, memberId)
      if (!member || member.kind !== 'agent') {
        throw new WfError(`WF_NODE_KIND: a collaboration-group member must be an agent node: ${memberId}`, 'WF_NODE_KIND')
      }
      members.push({ id: memberId, node: member })
    }

    // 成员任务块：与单节点路径同一构建器；协作块使用官方通道文案（send_message + 成员名）
    const plans: GroupMemberPlan[] = []
    for (const { id: memberId, node: member } of members) {
      // 成员 db-in 索引预建：与单节点路径同一时机（启动前吸收构建耗时；best-effort）
      if (this.deps.dbIndexer) await this.deps.dbIndexer.ensureIndexes(memberId, flow)
      const blocks = buildNodeBlocks({
        flow,
        node: member,
        snapshot: run.snapshot,
        documentTextLimit: this.deps.config.documentTextLimit,
        systemLanguage: run.snapshot.systemLanguage ?? this.deps.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE,
        collabChannel: 'official',
      })
      plans.push({
        node: member,
        blocks,
        ...(thinking !== undefined ? { thinking } : {}),
        ...(effectiveReactLimit !== undefined ? { iterationLimit: effectiveReactLimit } : {}),
      })
    }

    setNodeStatus(run.snapshot, groupId, 'running', { attempts: attempt, now: this.now() })
    let result: GroupStartResult | null
    try {
      result = await startGroup.call(runner, {
        sessionId,
        flowId: run.snapshot.flowId,
        mode: 'mode1',
        groupId,
        collabPrompt: String(group.data.collabPrompt ?? ''),
        members: plans,
        signal: run.controller.signal,
      })
    } catch (error) {
      if (run.snapshot.status === 'running') {
        setNodeStatus(run.snapshot, groupId, 'fail', { attempts: attempt, now: this.now() })
      }
      throw error
    }
    if (!result) {
      // 启动瞬间能力消失（服务卸载/根 Agent 退出）：回退指令要显式，不静默留下 running 组卡片
      setNodeStatus(run.snapshot, groupId, 'fail', { attempts: attempt, now: this.now() })
      throw new WfError(
        `WF_TEAM_UNAVAILABLE: the official Agent Team became unavailable while starting collaboration group "${labelOf(group)}"; ` +
        `start its member nodes one by one with wf_run_node: [${memberIds.join(', ')}].`,
        'WF_TEAM_UNAVAILABLE',
      )
    }

    // 登记成员会话归属：成员 subagent/end 据此回写各自节点状态（与单节点路径同一张表）
    for (const member of result.members) {
      run.inflight.add(member.childId)
      this.childIndex.set(member.childId, { sessionId, flowId: run.snapshot.flowId, nodeId: member.nodeId })
      this.childByNode.set(member.nodeId, member.childId)
    }
    await this.persistWarn(run)
    return {
      nodeId: groupId,
      status: 'started',
      members: result.members.map((member) => ({ nodeId: member.nodeId, target: member.target, childId: member.childId })),
    }
  }

  // ---- wf_finish ------------------------------------------------------------

  /**
   * wf_finish：父代理收尾信号 → 写完成/失败记录并释放运行锁。幂等。
   * 运行锁降权（用户裁决）：本会话停在 paused/stopped/interrupted 断点时先静默接续接管
   * （只接管运行事实与锁，不注入编排指令），父代理可确认流程已走完后直接收尾，
   * 不再报 WF_NO_ACTIVE_RUN；只有「本会话既无激活运行也无任何可恢复断点」才按旧语义
   * 返回终态幂等/报错。
   */
  async wfFinish(caller: CallerInfo, args: FinishArgs): Promise<FinishResult> {
    if (caller.isChild) throw new WfError('WF_NOT_ROOT: a child agent cannot call wf_finish; only the session main agent may close an orchestration', 'WF_NOT_ROOT')
    const sessionId = caller.sessionId
    const run = sessionId ? await this.ensureActiveRun(sessionId) : null
    // 执行者模式：wf_finish 同样视为父代理自身任务完成（无后续调度、直接收尾的流程）
    if (run) this.markParentExecutorDone(run)
    // 已停止/已完成的幂等：允许对已终止的同会话运行静默返回。
    // 终态条目已从内存释放（防内存膨胀），故幂等判定查磁盘历史（收尾调用频率极低）。
    if (!run) {
      try {
        for (const runId of await this.deps.store.listAllRunIds()) {
          const record = await this.deps.store.getRun(runId)
          if (record && record.sessionId === sessionId && record.status !== 'running') {
            return { ok: true, runId: record.id, status: record.status, idempotent: true }
          }
        }
      } catch {
        // 磁盘读失败按无历史处理
      }
      throw new WfError('WF_NO_ACTIVE_RUN: no running orchestration in this session', 'WF_NO_ACTIVE_RUN')
    }
    const snapshot = run.snapshot
    if (snapshot.status !== 'running') return { ok: true, runId: snapshot.id, status: snapshot.status, idempotent: true }
    const isFailed = args?.status === 'failed'
    snapshot.status = isFailed ? 'failed' : 'completed'
    snapshot.summary = String(args?.summary ?? '')
    snapshot.endedAt = this.isoNow()
    terminalizeNodes(snapshot, this.now(), isFailed ? 'fail' : 'completed')
    await this.persistWarn(run)
    // 收尾完成即释放内存条目（终态已持久化；运行锁随状态自然释放）
    this.releaseRunMemory(snapshot.id)
    return { ok: true, runId: snapshot.id, status: snapshot.status }
  }
}