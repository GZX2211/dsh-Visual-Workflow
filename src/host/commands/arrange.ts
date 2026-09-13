// src/host/commands/arrange.ts
//
// `/arrange` 斜杠命令（自主编排实施方案 §10 P2；用户裁决：命令名用英文 `/arrange`）。
//
// 职责边界（**只采集 + 注入，绝不改图**）：
//   - 采集：调用者 agent（接收方）+ rawInput（用户意图）+ 系统语言；
//   - 注入：buildOrgPlanPrompt 组装的规划提示词，作为一条普通用户消息 followup
//     给接收 agent，从而开始一轮规划（与 startRun 的指令注入同一通道语义）；
//   - 不改图：不调用任何 store 写接口、不创建模板/实例、不启动运行（D-11）。
//
// 目标模板的确定：命令层**不绑定** targetId —— 规划期主用例是「无模板 → 产出模板」
// （用户裁决 2026.09）：父代理先 wf_org_catalog 勘察，再用
// wf_graph_patch（scope=template + create）新建，工具返回的 targetId 即新模板 id；
// 若用户意图明确指向既有模板/实例，父代理勘察后自行改用更新语义（提示词已写清两种语法）。
//
// 注册降级：commands 服务未组合（headless / 模式二服务进程）时**静默跳过**，
// 不影响既有行为；注册返回官方 disposer，随 ctx.effect 注销。

import { randomUUID } from 'node:crypto'

import { buildOrgPlanPrompt } from '../prompts/index.js'

/** 命令名（用户裁决：英文命名，不用中文）。 */
export const ARRANGE_COMMAND_NAME = 'arrange'

/** 命令用法提示（空意图时直接返回，不消耗一次模型回合）。 */
export const ARRANGE_USAGE = '用法：/arrange <规划意图>（例如：/arrange 做一个内容生产流水线，含选题、成稿、发布三个阶段）'

/** 注入消息（官方 Message 契约：id + source 必填，否则父回合失败——旧项目复盘结论）。 */
export interface ArrangeInjectedMessage {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

/** 命令调用上下文（官方 CommandInvocation 的最小结构子集；运行时守卫）。 */
export interface ArrangeInvocation {
  /** 接收方 agent（根会话 agent；followup 即投递一条用户消息）。 */
  agent?: {
    id?: unknown
    followup?: (message: ArrangeInjectedMessage) => void
  }
  /** 命令名之后的原始输入（含分隔空白）。 */
  rawInput?: unknown
}

/** 命令结果（官方 CommandResult 子集）。 */
export type ArrangeCommandResult =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

/** commands 服务最小形状（官方 ctx.commands 子集）。 */
export interface CommandsServiceLike {
  register(definition: {
    name: string
    description: string
    input?: { hint: string; attachments?: boolean }
    handler: (invocation: ArrangeInvocation) => ArrangeCommandResult | Promise<ArrangeCommandResult>
  }): () => void
}

/** 命令装配依赖（可注入缝，便于单测给确定性 id 与语言）。 */
export interface ArrangeCommandDeps {
  /** 系统语言名提供者（读 DSH 用户设置；缺省空串 = 不注入语言规则）。 */
  systemLanguage?: () => string
  /** 注入消息 id 生成缝（单测用确定性 id）。 */
  newMessageId?: () => string
  /** 日志缝（注销失败告警；缺省静默）。 */
  logger?: { warn(message: string): void }
}

/**
 * 构建 `/arrange` 注入的规划提示词（纯函数）。
 * 目标固定为 create（新建模板）；既有目标的更新语义由提示词内的语法指引覆盖。
 */
export function buildArrangePrompt(input: { userIntent: string; systemLanguage?: string }): string {
  const language = String(input.systemLanguage ?? '').trim()
  return buildOrgPlanPrompt({
    facts: { target: 'create', ...(language ? { systemLanguage: language } : {}) },
    dynamic: { userIntent: String(input.userIntent ?? '') },
  })
}

/** 命令失败文案：接收 Agent 未激活。 */
export const ARRANGE_NO_AGENT = '当前会话不可用于编排规划（接收 Agent 未激活）。'

/** 命令成功后的 UI 直出文案（不进入模型上下文）。 */
export const ARRANGE_ACCEPTED_TEXT =
  '已注入编排规划指令（/arrange）：父代理会先调用 wf_org_catalog 勘察现有资产，再用 wf_graph_patch' +
  "（scope=template + create）产出新模板。规划完成不会自动运行，投产需你确认后再点「运行」。"

/**
 * 注册 `/arrange` 命令（全局层；命令面缺失时静默跳过）。
 * @returns disposer：注销命令注册（命令面缺失时为 no-op）。
 */
export function registerArrangeCommand(
  ctx: { get(name: string): unknown },
  deps: ArrangeCommandDeps = {},
): () => void {
  const commands = ctx.get('commands') as CommandsServiceLike | null | undefined
  if (!commands || typeof commands.register !== 'function') {
    // 无命令面（headless / 模式二服务进程）：不是错误，静默跳过
    return () => {}
  }
  const dispose = commands.register({
    name: ARRANGE_COMMAND_NAME,
    description: 'plan and create a workflow template from a natural-language intent',
    input: { hint: '[规划意图]' },
    handler: (invocation) => {
      const agent = invocation?.agent
      const followup = agent?.followup
      if (!agent || typeof followup !== 'function') {
        return { kind: 'error', text: ARRANGE_NO_AGENT }
      }
      const intent = String(invocation?.rawInput ?? '').trim()
      if (!intent) return { kind: 'error', text: ARRANGE_USAGE }
      const text = buildArrangePrompt({ userIntent: intent, systemLanguage: deps.systemLanguage?.() })
      followup.call(agent, {
        id: deps.newMessageId?.() ?? randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      return { kind: 'success', text: ARRANGE_ACCEPTED_TEXT }
    },
  })
  return () => {
    try {
      dispose()
    } catch (error) {
      deps.logger?.warn(`[visual-workflow] /arrange 命令注销失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
