// src/host/tools/wf-ask/tool.ts
//
// wf_ask 工具注册（子代理向主会话用户提问）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 身份派生（callerOf）+ 归属校验 + 参数归一化」；
//   - wf_ask 直接借用官方 userQuestions.ask（agent 必须是注册表的精确存活 root；
//     无 provider 时 NO_PROVIDER 错误由官方抛出）——父代理侧提问请用官方
//     ask_user_question，本工具仅子代理可用（WF_NOT_CHILD 校验）。
//
// 工具可见性：可选注入——子代理工具集是否含它由组合勾选决定，本层只校验
// 「调用者必须是子代理」。
//
// 提示词规范：description 与参数说明使用官方标准英文，第一句写明「何时调用」，
// 随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（阻塞提问）；目标 ≤ 120 tokens。

import { WF_ASK } from '../../shared/protocol.js'
import { WfError, statusText } from '../../orchestrator/index.js'
import { callerOf, type WfToolsHost } from '../infrastructure/caller.js'
import { defineTool, type ToolDefinitionLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'

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

/** 组合阻塞信号（运行控制器 ∪ 调用方信号；官方 AbortSignal.any 语义）。 */
function combinedSignal(runSignal: AbortSignal, callerSignal: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([runSignal, callerSignal])
  return runSignal // 旧环境兜底（Node 20 起必有 any，防御性分支）
}

/**
 * 注册 wf_ask（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfAsk(
  ctx: { get(name: string): unknown },
  host: WfToolsHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_ask')
  }

  const definition = defineTool({
    name: WF_ASK,
    description:
      'Ask the main-session user questions on behalf of a workflow child agent. ' +
      'Use when a node child needs a user decision: presents an official question card and blocks until answered; one call can carry multiple questions and returns all answers at once. ' +
      'Only children of a running orchestration may call this (the parent agent uses ask_user_question); aborts with WF_CANCELLED when the run stops or the card is closed.',
    parameters: {
      questions: {
        type: 'array',
        required: true,
        // 不写 minItems：官方 tools 的 JSON Schema 受支持子集
        // （type/oneOf/properties/required/additionalProperties/items/enum/const + 注解）
        // 不含 minItems/maxItems。「至少一条问题」由 execute 运行时校验（归一化后长度为 0 即
        // 抛 WF_BAD_ARGS），语义不变且不依赖非子集关键字。
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

  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为（工具可能已被外部注销）
    }
  }
}
