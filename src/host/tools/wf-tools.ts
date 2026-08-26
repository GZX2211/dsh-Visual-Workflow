// src/host/tools/wf-tools.ts
//
// wf_run_node / wf_run_node_wait / wf_finish / wf_ask 四个父代理编排工具注册。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 身份派生（callerOf）+ 归属校验」，
//     执行语义（运行锁/快照/护栏/暂停门/wait 阻塞）全部收敛在编排运行时；
//   - wf_ask 直接借用官方 userQuestions.ask（agent 必须是注册表的精确存活 root；
//     无 provider 时 NO_PROVIDER 错误由官方抛出）——父代理侧提问请用官方
//     ask_user_question，本工具仅子代理可用（WF_NOT_CHILD 校验）。
//
// 工具可见性：
//   - wf_run_node / wf_finish 仅父代理可见：子代理侧经白名单剔除 + tools.restrict
//     双保险隐藏；本层再以 callerOf 归属校验兜底（WF_NOT_ROOT）。
//   - wf_ask 可选注入：子代理工具集是否含它由组合勾选决定，本层只校验
//     「调用者必须是子代理」。
//
// 提示词规范：description 与参数说明使用官方标准英文，第一句写明「何时调用」，
// 随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（异步启动 / 阻塞提问 /
// 幂等收尾）；单条 description 目标 ≤ 120 tokens。

import { WF_ASK, WF_FINISH, WF_RUN_NODE, WF_RUN_NODE_WAIT } from '../shared/protocol.js'
import type { CallerInfo, OrchestratorRuntime, RootAgentLike } from '../orchestrator/runtime.js'
import { WfError } from '../orchestrator/runtime.js'
import { statusText } from '../orchestrator/snapshot.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from './define-tool.js'
import { textRender } from './text-render.js'

// ---------------------------------------------------------------------------
// 调用方身份派生（callerOf）
// ---------------------------------------------------------------------------

/**
 * 从工具执行上下文派生调用方身份（CallerInfo）。
 * 官方 Session header 事实：子代理会话的 header 携带 `origin: 'subagent'` 与
 * `parentSession`（父会话 id）；根 Agent 会话无这两个字段，其 id 即会话 id。
 * 派生结果供 wf_run_node/wf_finish（仅根 Agent）与 wf_ask（仅子代理）归属校验共用。
 */
export function callerOf(exec: ToolExecLike): CallerInfo {
  const agent = exec?.agent as { id?: unknown; session?: { header?: Record<string, unknown> } } | null | undefined
  const header = agent?.session?.header ?? {}
  const isChild = header?.origin === 'subagent' || header?.parentSession !== undefined
  const sessionId = isChild
    ? String(header?.parentSession ?? '')
    : String(agent?.id ?? header?.id ?? '')
  return { isChild, sessionId }
}

// ---------------------------------------------------------------------------
// 宿主依赖缝（index.ts 装配；单测 fake）
// ---------------------------------------------------------------------------

/** 工具层所需宿主能力（宿主 service 的最小结构适配）。 */
export interface WfToolsHost {
  /** 编排运行时（wf_run_node/wf_finish/wf_ask 校验与执行）。 */
  orchestrator: OrchestratorRuntime
  /** 按会话取根 Agent（wf_ask 以父 root 身份发起官方提问）。 */
  getRootAgent(sessionId: string): RootAgentLike | null
}

/** userQuestions 服务最小结构（官方 ask 契约）。 */
interface UserQuestionsServiceLike {
  ask(request: {
    questions: unknown[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{ answers?: unknown[] }>
}

/** 规范化 wf_ask 的 questions（旧项目逻辑完整复制：id 回退/选项过滤/多选映射）。 */
function normalizeQuestions(raw: unknown[]): Array<Record<string, unknown>> {
  const questions: Array<Record<string, unknown>> = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index] as Record<string, unknown> | null | undefined
    const question = String(item?.question ?? '').trim()
    if (!question) continue
    const options = Array.isArray(item?.options)
      ? (item.options as Array<Record<string, unknown>>)
          .map((option) => ({
            label: String(option?.label ?? '').trim(),
            ...(typeof option?.description === 'string' && option.description.trim()
              ? { description: String(option.description).trim() }
              : {}),
          }))
          .filter((option) => option.label.length > 0)
      : undefined
    const normalized: Record<string, unknown> = {
      id: String(item?.id != null && String(item.id).trim() ? String(item.id).trim() : `q${index}`),
      question,
      ...(typeof item?.header === 'string' && item.header.trim() ? { header: String(item.header).trim() } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(item?.multi_select === true ? { multiSelect: true } : {}),
    }
    questions.push(normalized)
  }
  return questions
}

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------

/** 组合阻塞信号（运行控制器 ∪ 调用方信号；官方 AbortSignal.any 语义）。 */
function combinedSignal(runSignal: AbortSignal, callerSignal: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([runSignal, callerSignal])
  return runSignal // 旧环境兜底（Node 20 起必有 any，防御性分支）
}

/**
 * 注册四个父代理编排工具（全局层；ctx.tools.register）。
 * 返回 disposer：逐个注销，注销失败尽力而为。
 * 与旧项目注册实现的差异：
 *   - defineTool DSL（本地实现）替代手写 raw JSON Schema；
 *   - wf_run_node 新增 wait/thinking/iterationLimit/retryLimit 扩展参数
 *     （阻塞选择 + 节点级参数透传）；
 *   - 暂停门并入 wf_run_node（无独立 wf_pause 工具）。
 */
export function registerWfTools(
  ctx: { get(name: string): unknown },
  host: WfToolsHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_* 工具')
  }

  const disposers: Array<() => void> = []

    // 模式一编排执行：wf_run_node 仅异步非阻塞启动，不提供 wait 参数。
    const wfRunNodeDef = defineTool({
      name: WF_RUN_NODE,
      description:
        'Start one agent node of an orchestration run asynchronously. Use only in mode1: pass the node id from the flow definition file. ' +
        'Returns started with the child id immediately; do not wait for the node child. ' +
        'A pause-node id pauses the run and persists a checkpoint instead (returns paused). ' +
        'Child agents are rejected; fails with WF_* codes on invalid arguments, missing nodes, mode mismatch, or stopped runs.',
      parameters: {
        nodeId: { type: 'string', required: true, description: 'Node id from the flow definition file (nodes[].id) to start; proxy nodes resolve to their source node.' },
        thinking: { type: 'string', description: 'Optional reasoning-effort override for this node run; value domain follows the official adapter.' },
        iterationLimit: { type: 'number', description: 'Optional ReAct iteration-limit override (soft cap: the child stops calling tools and concludes).' },
        retryLimit: { type: 'number', description: 'Optional per-node retry-limit override (hard guard, over the node default).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nodeId: { type: 'string', required: true, description: 'The resolved node id that was started.' },
            status: { type: 'string', required: true, enum: ['started', 'paused'] as const, description: 'started: async start; paused: pause gate.' },
            childId: { type: 'string', description: 'The node child session id (started path).' },
          },
        },
        render: textRender,
      },
      execute: (args, exec) => host.orchestrator.wfRunNode(callerOf(exec), args ?? {}, exec.signal, { expectedMode: 'mode1' }),
    })
    disposers.push(tools.register(wfRunNodeDef))

    // 模式二后台服务：wf_run_node_wait 阻塞等待节点完成，返回 ok/fail + 最终输出。
    const wfRunNodeWaitDef = defineTool({
      name: WF_RUN_NODE_WAIT,
      description:
        'Start one agent node of a service run and block until it finishes. Use only in mode2: pass the node id from the flow definition file. ' +
        'Returns ok/fail with the child final output when the node child completes, or paused for a pause-node id. ' +
        'Child agents are rejected; fails with WF_* codes on invalid arguments, missing nodes, mode mismatch, or stopped runs.',
      parameters: {
        nodeId: { type: 'string', required: true, description: 'Node id from the flow definition file (nodes[].id) to start; proxy nodes resolve to their source node.' },
        thinking: { type: 'string', description: 'Optional reasoning-effort override for this node run; value domain follows the official adapter.' },
        iterationLimit: { type: 'number', description: 'Optional ReAct iteration-limit override (soft cap: the child stops calling tools and concludes).' },
        retryLimit: { type: 'number', description: 'Optional per-node retry-limit override (hard guard, over the node default).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nodeId: { type: 'string', required: true, description: 'The resolved node id that was started.' },
            status: { type: 'string', required: true, enum: ['paused', 'ok', 'fail'] as const, description: 'ok/fail: blocked wait result; paused: pause gate.' },
            childId: { type: 'string', description: 'The node child session id (wait path).' },
            output: { type: 'string', description: 'Final child output summary (ok/fail wait path).' },
          },
        },
        render: textRender,
      },
      execute: (args, exec) => host.orchestrator.wfRunNode(callerOf(exec), { ...(args ?? {}), wait: true }, exec.signal, { expectedMode: 'mode2' }),
    })
    disposers.push(tools.register(wfRunNodeWaitDef))

  const wfFinishDef = defineTool({
    name: WF_FINISH,
    description:
      'Finish the active Visual Workflow orchestration. Call once when the whole flow is complete or cannot continue: marks the run completed/failed, persists the record, and releases the run lock; ' +
      'repeated calls on a finished run return idempotently. Only the parent agent may call this; child agents are rejected (WF_NOT_ROOT).',
    parameters: {
      status: { type: 'string', enum: ['completed', 'failed'] as const, description: 'completed (default) or failed.' },
      summary: { type: 'string', description: 'Short summary: finished nodes, key conclusions, open issues (a few hundred characters).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'Whether the finish was accepted.' },
          runId: { type: 'string', required: true, description: 'The finished run id.' },
          status: { type: 'string', required: true, enum: ['completed', 'failed', 'stopped', 'paused', 'interrupted'] as const, description: 'Terminal run status.' },
          idempotent: { type: 'boolean', description: 'True when the run was already terminal (idempotent repeat).' },
        },
      },
      render: textRender,
    },
    execute: (args, exec) => host.orchestrator.wfFinish(callerOf(exec), args ?? {}),
  })
  disposers.push(tools.register(wfFinishDef))

  const wfAskDef = defineTool({
    name: WF_ASK,
    description:
      'Ask the main-session user questions on behalf of a workflow child agent. ' +
      'Use when a node child needs a user decision: presents an official question card and blocks until answered; one call can carry multiple questions and returns all answers at once. ' +
      'Only children of a running orchestration may call this (the parent agent uses ask_user_question); aborts with WF_CANCELLED when the run stops or the card is closed.',
    parameters: {
      questions: {
        type: 'array',
        required: true,
        minItems: 1,
        description: 'Questions to ask (at least one); presented as an official question card and answered in one batch.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true, description: 'Stable question id, echoed in the answers.' },
            question: { type: 'string', required: true, description: 'The question text.' },
            header: { type: 'string', description: 'Optional short heading, e.g. "Choose Mode".' },
            options: {
              type: 'array',
              description: 'Optional answer choices; put the recommended one first and append "(Recommended)" to its label.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'User-facing option text.' },
                  description: { type: 'string', description: 'Optional one-sentence tradeoff/impact of this option.' },
                },
              },
            },
            multi_select: { type: 'boolean', description: 'Allow multiple selections (default false).' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answers: {
            type: 'array',
            required: true,
            description: 'Answers in the same order as the questions; skipped questions keep an empty selected array.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true, description: 'The corresponding question id.' },
                selected: { type: 'array', required: true, items: { type: 'string' }, description: 'Selected option labels; empty when skipped.' },
                custom: { type: 'string', description: 'Free-form user input (overrides selected for single-select; supplements for multi-select).' },
              },
            },
          },
        },
      },
      render: textRender,
    },
    async execute(args, exec) {
      const caller = callerOf(exec)
      if (!caller.isChild) {
        throw new WfError('wf_ask 仅供工作流中的子代理调用（父代理请使用 ask_user_question）', 'WF_NOT_CHILD')
      }
      // 子代理的会话归属 = 父会话（root）；运行必须存在且 running
      const run = caller.sessionId ? host.orchestrator.activeRunForSession(caller.sessionId) : null
      if (!run) {
        throw new WfError('当前没有正在运行的工作流编排上下文', 'WF_NO_ACTIVE_RUN')
      }
      if (run.snapshot.status !== 'running') {
        throw new WfError(`该工作流已${statusText(run.snapshot.status)}，无法提问`, 'WF_STOPPED')
      }
      const raw = Array.isArray(args?.questions) ? args.questions : null
      if (!raw || raw.length === 0) {
        throw new WfError('wf_ask 需要 questions 数组：[{ id, question, header?, options?, multi_select? }]', 'WF_BAD_ARGS')
      }
      const questions = normalizeQuestions(raw)
      if (questions.length === 0) {
        throw new WfError('wf_ask 的 questions 至少需要一条有效的问题（question 非空）', 'WF_BAD_ARGS')
      }
      const parentRoot = host.getRootAgent(caller.sessionId)
      if (!parentRoot) throw new WfError('主会话 Agent 未激活，无法向用户提问', 'WF_NO_ROOT_AGENT')
      const userQuestions = ctx.get('userQuestions') as UserQuestionsServiceLike | null | undefined
      if (!userQuestions || typeof userQuestions.ask !== 'function') {
        throw new WfError('userQuestions 服务不可用，无法向主会话用户提问', 'WF_NO_ASK_PROVIDER')
      }
      // 提问期间持续触碰空闲基准（防止空闲看护误停）
      host.orchestrator.touchRun(run)
      const signal = combinedSignal(run.controller.signal, exec.signal)
      try {
        const result = await userQuestions.ask({ questions, agent: parentRoot, signal })
        return { answers: Array.isArray(result?.answers) ? result.answers : [] }
      } catch (error) {
        const code = (error as { code?: string })?.code ?? ''
        const message = error instanceof Error ? error.message : String(error)
        if (code === 'ASK_ABORTED' || /aborted|cancelled/i.test(message)) {
          throw new WfError('提问已取消（工作流停止或你关闭了提问卡片）', 'WF_CANCELLED')
        }
        throw error
      }
    },
  })
  disposers.push(tools.register(wfAskDef))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 注销尽力而为（工具可能已被外部注销）
      }
    }
  }
}
