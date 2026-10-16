// src/host/tools/wf-ask-user/tool.ts
//
// wf_ask_user 工具注册（子代理向主会话用户提问）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 身份派生（callerOf）+ 提问身份分派 + 参数归一化」；
//   - wf_ask_user 直接借用官方 userQuestions.ask：官方只接受「精确存活的 runtime root」
//     （agents.roots() 只含无 owner 的顶层 agent），子代理传自己必然 DELEGATED_CALLER，
//     故子代理路径借其会话的 root 身份，其它 agent 直接用自身（见 execute）。
//
// 工具可见性：可选注入——是否进入某 agent 的工具集由组合勾选与全局开关决定；
// 本层不做调用者身份校验（任何 agent 均可提问）。
//
// 提示词规范：description 与参数说明使用官方标准英文，第一句写明「何时调用」，
// 随后是失败语义（WF_* 稳定错误码，码随错误文本一并可见）/副作用（阻塞提问）；
// 目标 ≤ 120 tokens。

import { WF_ASK_USER } from '../../shared/protocol.js'
import { WfError } from '../../orchestrator/index.js'
import { callerOf, type WfToolsHost } from '../infrastructure/caller.js'
import { defineTool } from '../infrastructure/define-tool.js'
import { registerTool, requireToolsService } from '../infrastructure/register-tool.js'
import { textRender } from '../infrastructure/text-render.js'

/** userQuestions 服务最小结构（官方 ask 契约）。 */
interface UserQuestionsServiceLike {
  ask(request: {
    questions: unknown[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{ answers?: unknown[] }>
}

/** 规范化 wf_ask_user 的 questions（旧项目逻辑完整复制：id 回退/选项过滤/多选映射）。 */
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
 * 注册 wf_ask_user（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfAskUser(
  ctx: { get(name: string): unknown },
  host: WfToolsHost,
): () => void {
  const tools = requireToolsService(ctx, WF_ASK_USER)

  const definition = defineTool({
    name: WF_ASK_USER,
    description:
      'Ask the user questions and wait for an answer. ' +
      'Use when a decision or fact cannot be resolved from files, code, or other tools: shows an official question card in the main session and blocks until the user answers or cancels it. ' +
      'One call carries multiple questions and returns all answers at once. ' +
      'Fails with WF_CANCELLED if the run stops or the card closes.',
    parameters: {
      questions: {
        type: 'array',
        required: true,
        // 不写 minItems：官方 tools 的 JSON Schema 受支持子集
        // （type/oneOf/properties/required/additionalProperties/items/enum/const + 注解）
        // 不含 minItems/maxItems。「至少一条问题」由 execute 运行时校验（归一化后长度为 0 即
        // 抛 WF_BAD_ARGS），语义不变且不依赖非子集关键字。
        description: 'Questions to ask (at least one), answered as one batch.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true, description: 'Stable id, echoed in the answers.' },
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
                selected: { type: 'array', required: true, items: { type: 'string' }, description: 'Selected option labels.' },
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
      // 提问身份分派：官方 ask 只接受「注册表精确存活的 runtime root」，而子代理是 owned
      // child（agents.roots() 不含它）——传自己必然 DELEGATED_CALLER；故子代理借其会话的
      // root 身份，其它 agent 直接用自身（天然满足官方校验，且少一次 agents 服务依赖）。
      const target = caller.isChild ? host.getRootAgent(caller.sessionId) : (exec.agent ?? null)
      if (!target) {
        throw new WfError(
          'WF_NO_ASK_TARGET: no live root agent for this session; the session must stay open to answer questions',
          'WF_NO_ASK_TARGET',
        )
      }
      const raw = Array.isArray(args?.questions) ? args.questions : null
      if (!raw || raw.length === 0) {
        throw new WfError(
          'WF_BAD_ARGS: questions must be a non-empty array of { id, question, header?, options?, multi_select? }',
          'WF_BAD_ARGS',
        )
      }
      const questions = normalizeQuestions(raw)
      if (questions.length === 0) {
        throw new WfError('WF_BAD_ARGS: every question needs non-empty question text', 'WF_BAD_ARGS')
      }
      const userQuestions = ctx.get('userQuestions') as UserQuestionsServiceLike | null | undefined
      if (!userQuestions || typeof userQuestions.ask !== 'function') {
        throw new WfError('WF_NO_ASK_PROVIDER: the user-questions service is unavailable', 'WF_NO_ASK_PROVIDER')
      }
      // 提问期间触碰空闲基准：仅在确有活跃运行时（子代理路径）——长阻塞不得被空闲看护
      // 误判停顿；脱离运行（父/主代理直问）时无运行可触碰，跳过即可。
      const run = caller.sessionId ? host.orchestrator.activeRunForSession(caller.sessionId) : null
      if (run) host.orchestrator.touchRun(run)
      // 有运行则并入其取消信号：运行停止要撤销悬挂的提问卡；无运行只用调用方信号。
      const signal = run ? combinedSignal(run.controller.signal, exec.signal) : exec.signal
      try {
        const result = await userQuestions.ask({ questions, agent: target, signal })
        return { answers: Array.isArray(result?.answers) ? result.answers : [] }
      } catch (error) {
        const code = (error as { code?: string })?.code ?? ''
        if (code === 'ASK_ABORTED' || code === 'ASK_CANCELLED' || code === 'ASK_TIMED_OUT') {
          throw new WfError('WF_CANCELLED: the question was cancelled before the user answered', 'WF_CANCELLED')
        }
        throw error
      }
    },
  })

  return registerTool(tools, definition)
}
