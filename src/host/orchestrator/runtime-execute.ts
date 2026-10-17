// src/host/orchestrator/runtime-execute.ts
//
// 编排运行时节点执行层（RuntimeExecute extends RuntimeLaunch）：wf_run_node
// （异步/暂停门/阻塞三路径）与 wf_finish（父代理收尾，幂等）。方法体逐字移动。
//
// 运行锁降权（用户裁决）：两者的运行上下文获取统一经 ensureActiveRun——本会话停在
// paused/stopped/interrupted 断点时**静默接续**接管（只接管运行事实与锁，不注入编排
// 指令、不要求父代理空闲），不再以 WF_PAUSED/WF_STOPPED 阻断，也不再需要人工点「运行」。

import { WF_RUN_NODE_WAIT } from '../shared/protocol.js'
import { isGroupMember, nodeById } from '../graph/index.js'
import { DEFAULT_SYSTEM_LANGUAGE } from '../system-language.js'
import { collabPromptOf, labelOf } from './graph-facts.js'
import { effectiveReactLimitOf, effectiveRetryLimitOf, effectiveThinkingOf } from './node-params.js'
import { buildNodeBlocks } from './task-blocks.js'
import { WfError } from './errors.js'
import { createWaiter, type FinishArgs, type FinishResult, type RunEntry, type RunNodeArgs, type RunNodeResult, type Waiter } from './run-entry.js'
import { hasProducedOutput, setNodeStatus, terminalizeNodes } from './snapshot.js'
import { GLOBAL_RUN_CALL_LIMIT, type CallerInfo } from './seams.js'
import { RuntimeLaunch } from './runtime-launch.js'

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

    // Team 卡片是包裹层，不是执行主体（用户裁决 2026-10）：它只能是流程上的位置锚点，
    // 成员节点才是执行单元。以组 id 启动整组属已退役的旧语义，明确拒绝并给出成员清单。
    if (node.kind === 'group') {
      const memberIds = [...new Set(((node.data.memberIds ?? []) as unknown[]).map((id) => String(id ?? '')).filter(Boolean))]
      throw new WfError(
        `WF_NODE_KIND: "${labelOf(node)}" is a Team card (a wrapper, not an execution unit). `
        + `Start its member nodes one by one with wf_run_node: [${memberIds.join(', ') || '(no members)'}].`,
        'WF_NODE_KIND',
      )
    }

    if (node.kind !== 'agent') {
      throw new WfError(`WF_NODE_KIND: wf_run_node only accepts an agent node; "${labelOf(node)}" is ${node.kind}`, 'WF_NODE_KIND')
    }
    // 模式二完全不支持 Team（用户裁决 2026-10）：阻塞等待语义与团队异步协作不匹配，
    // 成员节点在 wf_run_node_wait 通道下同样拒绝（模式一才允许）。
    if (run.snapshot.mode === 'mode2' && isGroupMember(flow, node.id)) {
      throw new WfError(
        `WF_NODE_KIND: wf_run_node_wait does not accept a Team member node ("${labelOf(node)}"); Team collaboration is available in mode1 only`,
        'WF_NODE_KIND',
      )
    }
    // 虚拟节点解析后一切以主节点 key 记账（共享同一子代理执行实例与快照记录）
    const resolvedNodeId = node.id

    // 硬护栏：全局调用上限 + 单节点失败重试上限。
    run.callCount += 1
    if (run.callCount > GLOBAL_RUN_CALL_LIMIT) {
      throw new WfError(`WF_GLOBAL_LIMIT: orchestration exceeded the global call limit (${GLOBAL_RUN_CALL_LIMIT} wf_run_node calls); stopped automatically`, 'WF_GLOBAL_LIMIT')
    }
    // retryLimit 只约束**失败重试**（该节点上次已成功结算 → 本次是重新调度新任务，不算重试）：
    // 已完成节点（ok / react-capped / armed）再次被调度既不递增失败重试计数、也不受
    // retryLimit 约束，仍受上方全局调用上限约束。
    const previousStatus = run.snapshot.nodes.find((item) => item.nodeId === resolvedNodeId)?.status
    const rescheduled = previousStatus !== undefined && hasProducedOutput(previousStatus)
    const attempt = (run.attempts.get(resolvedNodeId) ?? 0) + (rescheduled ? 0 : 1)
    if (!rescheduled) {
      run.attempts.set(resolvedNodeId, attempt)
      const effectiveRetryLimit = effectiveRetryLimitOf(node, args, this.deps.config.retryLimitDefault)
      if (attempt > effectiveRetryLimit + 1) {
        throw new WfError(`WF_RETRY_LIMIT: node "${labelOf(node)}" exceeded its retry limit (at most ${effectiveRetryLimit} retries)`, 'WF_RETRY_LIMIT')
      }
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
    // 任务块统一组装：可通信对象清单对成员与非成员同一段注入（不再按协作通道分叉）
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
        ...(isGroupMember(flow, node.id) ? { teamMember: true } : {}),
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
        // 口径（D02-06）：只认「本会话最近一条运行」——旧实现按目录遍历顺序取第一条非
        // running 记录，会把任意一条本会话的旧终态运行当成本次请求的收尾结果（多实例/
        // 多工作流会话下报告错误状态与 runId）。为什么不直接用 listRuns(flowId, sessionId)：
        // wf_finish 的调用方身份只有 sessionId（工具层不携带 flowId），且「本次请求的
        // flowId」在无激活运行时本就无从取得，故在唯一可用的扫描入口上显式过滤 + 倒序取最新。
        // 扫描语义（跳过非本资源文档）：单个坏文件不得让幂等判定整体失效。
        const latest = (await this.deps.store.listAllRuns())
          .filter((record) => record.sessionId === sessionId)
          .sort((a, b) => (String(a.startedAt ?? '') < String(b.startedAt ?? '') ? 1 : -1))[0]
        if (latest && latest.status !== 'running') {
          return { ok: true, runId: latest.id, status: latest.status, idempotent: true }
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
