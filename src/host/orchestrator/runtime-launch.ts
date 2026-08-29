// src/host/orchestrator/runtime-launch.ts
//
// 编排运行时启动层（RuntimeLaunch extends RuntimeBase）：startRun（模式一/二
// 全新启动）与 resumeRun（paused/interrupted 断点续跑）。方法体逐字移动。

import { randomUUID } from 'node:crypto'
import { buildOrchestrationDirective } from '../prompts/orchestration.js'
import { buildResumedSnapshot, findResumableRun, type ResumeInput, type ResumeResult } from './resume.js'
import { createRunSnapshot, setNodeStatus, statusText } from './snapshot.js'
import { directiveParams, messageOf, missingStageLabels, validateFlowForRun } from './helpers.js'
import type { StartRunOptions, StartRunResult, RunEntry } from './run-types.js'
import { WfError } from './seams.js'
import { RuntimeBase } from './runtime-base.js'

export class RuntimeLaunch extends RuntimeBase {
  // ---- 编排启动 --------------------------------------------------------------

  /**
   * 启动一次「父代理编排」运行（模式一入口）。
   * 流程：校验 → 运行锁 → 建 run 状态 → 写流程事实源文件 → 构造编排指令 →
   * followup 一次性注入+唤醒父代理 → 开始即落盘（崩溃后历史可追溯）。
   */
  async startRun(input: { sessionId: string; flowId: string } & StartRunOptions): Promise<StartRunResult> {
    const sessionId = String(input.sessionId ?? '')
    const flowId = String(input.flowId ?? '')
    const mode = input.mode ?? 'mode1'
    if (!sessionId || !flowId) throw new WfError('requires sessionId and flowId', 'WF_BAD_ARGS')

    // 运行锁护栏：跨会话冲突 / 同会话重复 / 暂停保留锁
    // （登记前还会在同一同步块内重检一次，见 runs.set 前注释——杜绝并发双运行）
    this.assertFlowLockFree(flowId, sessionId)

    const flow = mode === 'mode2'
      ? await this.deps.store.getServiceAsFlow(flowId)
      : await this.deps.store.getWorkflow(sessionId, flowId)
    if (!flow) throw new WfError(mode === 'mode2' ? '服务不存在' : '工作流不存在', 'WF_NOT_FOUND')

    // 运行前完整性：启动/输入与结束/输出必须齐备（保存中间态与运行分离）
    const missing = missingStageLabels(flow)
    if (missing.length > 0) {
      throw new WfError(`工作流不完整：缺少${missing.join('、')}节点，无法运行`, 'WF_FLOW_INCOMPLETE')
    }
    const validation = validateFlowForRun(flow)
    if (validation !== null) throw validation

    if (!this.deps.agents.available()) {
      throw new WfError('Agent 能力不可用；父代理编排模式需要会话根 Agent 与可延续子代理', 'WF_AGENT_UNAVAILABLE')
    }
    const root = this.deps.agents.getRootAgent(sessionId)
    if (!root) throw new WfError('当前会话 Agent 未激活；请先在对话区发送一条消息后重试', 'WF_ROOT_INACTIVE')
    if (root.status === 'running') throw new WfError('父代理当前正在忙碌，请稍后再运行', 'WF_ROOT_BUSY')

    // 父代理（会话根 Agent）配置注入：角色 Prompt 段（含 .md 路径读取）+ 官方系统提示词开关 +
    // 工具散文段开关 + 模型/思考强度。非侵入：挂载到根 Agent 的 ctx，仅对本会话生效，不修改官方源码。
    await this.bindParentConfig(flow, root, sessionId)

    const runId = this.deps.newRunId?.() ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const snapshot = createRunSnapshot({ runId, flow, sessionId, mode, now: this.now() })
    // 模式二：用户问题注入输入节点产出（无需连线即作为初始上下文；
    // 右出 ctx 连线经 buildNodeBlocks 的 start 源分支显式传递给下游）
    const question = typeof input.question === 'string' ? input.question.trim() : ''
    if (mode === 'mode2' && question) {
      const inputNode = flow.nodes.find((n) => n.kind === 'start')
      if (inputNode) {
        setNodeStatus(snapshot, inputNode.id, 'ok', {
          output: question,
          outputFullLimit: this.deps.config.outputFullLimit,
          now: this.now(),
        })
      }
    }
    const entry: RunEntry = {
      controller: new AbortController(),
      snapshot,
      baseFlow: flow,
      inflight: new Set(),
      attempts: new Map(),
      callCount: 0,
      lastActiveAt: this.now(),
      waiters: new Map(),
      asks: new Map(),
    }
    // 运行锁登记（check-then-act 竞态收口）：并发 startRun 可能已在本请求的
    // await 期间登记了同一 flowId 的 run。此处重检 + runs.set 在同一同步块内
    // 完成（Node 单线程内无交错），保证同工作流最多一个激活 run。
    this.assertFlowLockFree(flowId, sessionId)
    this.runs.set(runId, entry)

    // 流程事实源文件（父代理可 read，只读；defPath 注入编排指令）
    const defPath = this.deps.store.orchestrationFilePath(runId)
    try {
      await this.deps.store.saveOrchestration(runId, flow)
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`流程定义文件写入失败：${messageOf(error)}`, 'WF_DEF_WRITE_FAILED')
    }

    // 一次性注入 + 唤醒：官方 Message 契约要求 id 与 source 齐备（缺 source 父回合
    // 以 UNKNOWN 失败——旧项目根因复盘结论，必须保留）。
    const directive = buildOrchestrationDirective(directiveParams(flow, defPath, mode, { question }))
    try {
      this.deps.agents.followupRoot(root, {
        id: this.deps.uuid?.() ?? randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: directive }],
        source: { kind: 'user' },
      })
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`编排指令注入失败：${messageOf(error)}`, 'WF_INJECT_FAILED')
    }

    // 运行记录：开始即落盘（中断/崩溃后历史面板仍有记录）
    await this.persistWarn(entry)
    return { runId, defPath }
  }

  // ---- 断点续跑（resumeRun） --------------------------------------------------

  /**
   * 断点续跑：从 paused/interrupted 的旧 run 创建新 run（resumedFromRunId 继承链）。
   * 已 ok/react-capped 节点继承状态与完整产出（resumed 标记，不重跑），其余节点
   * 回退 pending 重新执行；断点产出随继承快照重新可用（后续节点 ctx 注入直接用
   * 新快照，无需额外回填通道）。
   * 旧 paused 记录保留在磁盘历史（状态不变），内存条目释放——运行锁随新 run 接管。
   */
  async resumeRun(input: ResumeInput): Promise<ResumeResult> {
    const sessionId = String(input.sessionId ?? '')
    const flowId = String(input.flowId ?? '')
    if (!sessionId || !flowId) throw new WfError('requires sessionId and flowId', 'WF_BAD_ARGS')

    const prev = await findResumableRun(this.deps.store, { sessionId, flowId, fromRunId: input.fromRunId })
    if (!prev) {
      if (input.fromRunId) {
        const run = await this.deps.store.getRun(input.fromRunId)
        if (run && (run.sessionId !== sessionId || run.flowId !== flowId)) {
          throw new WfError('指定的运行不属于该工作流', 'WF_BAD_ARGS', { runId: input.fromRunId })
        }
        throw new WfError(
          run ? `该运行已${statusText(run.status)}，无法恢复` : '指定的运行不存在',
          run ? 'WF_NOT_RESUMABLE' : 'WF_NOT_FOUND',
          { runId: input.fromRunId },
        )
      }
      throw new WfError('该工作流没有可恢复的断点（暂停或中断记录）', 'WF_NO_RESUME_POINT')
    }

    // 运行锁护栏：同会话 paused 允许恢复（启动后锁移交新 run）；其余冲突拒绝
    // （登记前还会在同一同步块内重检一次，见 runs.set 前注释）
    this.assertResumeLockFree(flowId, sessionId)

    const flow = prev.mode === 'mode2'
      ? await this.deps.store.getServiceAsFlow(flowId)
      : await this.deps.store.getWorkflow(sessionId, flowId)
    if (!flow) throw new WfError(prev.mode === 'mode2' ? '服务不存在' : '工作流不存在', 'WF_NOT_FOUND')

    // 运行前完整性（与全新启动同一套校验）
    const missing = missingStageLabels(flow)
    if (missing.length > 0) {
      throw new WfError(`工作流不完整：缺少${missing.join('、')}节点，无法运行`, 'WF_FLOW_INCOMPLETE')
    }
    const validation = validateFlowForRun(flow)
    if (validation !== null) throw validation

    if (!this.deps.agents.available()) {
      throw new WfError('Agent 能力不可用；父代理编排模式需要会话根 Agent 与可延续子代理', 'WF_AGENT_UNAVAILABLE')
    }
    const root = this.deps.agents.getRootAgent(sessionId)
    if (!root) throw new WfError('当前会话 Agent 未激活；请先在对话区发送一条消息后重试', 'WF_ROOT_INACTIVE')
    if (root.status === 'running') throw new WfError('父代理当前正在忙碌，请稍后再运行', 'WF_ROOT_BUSY')

    // 父代理（会话根 Agent）配置注入：角色 Prompt 段（含 .md 路径读取）+ 官方系统提示词开关 +
    // 工具散文段开关 + 模型/思考强度。非侵入：挂载到根 Agent 的 ctx，仅对本会话生效，不修改官方源码。
    await this.bindParentConfig(flow, root, sessionId)

    const runId = this.deps.newRunId?.() ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const snapshot = buildResumedSnapshot({ prev, runId, flow, sessionId, mode: prev.mode, now: this.now() })
    const entry: RunEntry = {
      controller: new AbortController(),
      snapshot,
      baseFlow: flow,
      inflight: new Set(),
      attempts: new Map(),
      callCount: 0,
      lastActiveAt: this.now(),
      waiters: new Map(),
      asks: new Map(),
    }
    // 运行锁登记（check-then-act 竞态收口）：并发 resumeRun/startRun 可能已在本
    // 请求的 await 期间登记同一 flowId 的 run；重检 + 写入同一同步块内完成。
    this.assertResumeLockFree(flowId, sessionId)
    this.runs.set(runId, entry)

    // 流程事实源文件（同 startRun；defPath 注入编排指令）
    const defPath = this.deps.store.orchestrationFilePath(runId)
    try {
      await this.deps.store.saveOrchestration(runId, flow)
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`流程定义文件写入失败：${messageOf(error)}`, 'WF_DEF_WRITE_FAILED')
    }

    // 断点继续指令：isResume 动态态注入末段（已 ok 不重跑；从 resumeFromNodeId 继续）。
    // 起点必须取自 buildResumedSnapshot 计算出的新快照（resume.ts 已推断：暂停断点用
    // prev.resumeFromNodeId，interrupted 中断无暂停点时取首个未完成节点）——若直接用
    // prev.resumeFromNodeId，宿主重启中断的恢复会因 undefined 注入「（未指定）」，
    // 父代理无从定位起点、可能从头重调度已 ok 节点（违反 §4.7 规则 6 已执行节点不重跑）。
    const directive = buildOrchestrationDirective(
      directiveParams(flow, defPath, prev.mode, {
        resume: { resumeFromNodeId: snapshot.resumeFromNodeId, resumedFromRunId: prev.id },
      }),
    )
    try {
      this.deps.agents.followupRoot(root, {
        id: this.deps.uuid?.() ?? randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: directive }],
        source: { kind: 'user' },
      })
    } catch (error) {
      this.runs.delete(runId)
      throw new WfError(`编排指令注入失败：${messageOf(error)}`, 'WF_INJECT_FAILED')
    }

    await this.persistWarn(entry)

    // 释放同工作流的旧 paused 内存条目（磁盘历史保留；锁随新 run 接管）
    for (const [oldId, oldEntry] of [...this.runs]) {
      const old = oldEntry.snapshot
      if (oldId !== runId && old.sessionId === sessionId && old.flowId === flowId && old.status === 'paused') {
        try {
          oldEntry.controller.abort('resumed')
        } catch {
          // 忽略清理期错误
        }
        this.rejectWaiters(oldEntry)
        this.rejectAsks(oldEntry)
        this.runs.delete(oldId)
      }
    }
    return { runId, defPath, resumedFromRunId: prev.id }
  }

}