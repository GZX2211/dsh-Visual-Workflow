// src/host/tools/infrastructure/experience-contract.ts
//
// 工具层经验契约（learn / recall / feedback 共用）：宿主能力缝 + 主体类型入参规则。
//
// 为什么独立于 caller.ts：调用方身份派生与经验能力缝是两件事，但两者都被两个以上
// Tool 以同一语义消费，因此都留在基础设施层——任何单个 Tool 目录都不得成为另一
// Tool 的依赖来源。
//
// 职责边界：只声明缝与纯校验/纯解析，不含业务执行语义；持久化、去重、检索口径与准入
// 判定全部属于 domain 层（由宿主组合根装配注入）。反馈的入参/出参类型直接引用经验域
// 公共入口的类型，不在此重声明第二套形状。

import { WfError } from '../../orchestrator/index.js'
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_WRONG_TYPE } from '../../shared/protocol.js'
import type {
  ExperienceEntry,
  ExperienceGenerationPromptEntry,
  ExperienceRecallHit,
  ExperienceType,
} from '../../shared/asset-types.js'
import type {
  ExperienceFeedbackInput,
  ExperienceFeedbackResult,
} from '../../experience/index.js'

/**
 * 工具层所需经验能力缝（宿主组合根装配真实实现；单测 fake）。
 *
 * 为什么传入调用方身份而不是会话 id：经验属于「主体」，主体解析需要区分子代理与父代理、
 * 并用子代理会话 id 定位其所属运行——这些事实只有调用方现场知道，由工具层随调用传入。
 * 为什么 candidates 是 unknown：候选形状与长度约束的校验归 domain（工具层只把模型侧的
 * snake_case 字段映射成草稿形状），这样未知字段才能被 domain 拒绝而不是在工具层被吞掉。
 */
export interface WfExperienceHost {
  experience: {
    initializePrompt(input: { caller: { isChild: boolean; sessionId: string; childId?: string }; type: ExperienceType }): Promise<{ prompt: ExperienceGenerationPromptEntry }>
    submit(input: { caller: { isChild: boolean; sessionId: string; childId?: string }; type: ExperienceType; candidates: unknown }): Promise<{ inserted: ExperienceEntry[]; skipped: Array<{ reason: string; decisionRetrievalText: string }> }>
    recall(input: { caller: { isChild: boolean; sessionId: string; childId?: string }; type: ExperienceType; query?: string; ids?: string[]; topK?: number }): Promise<
      | { kind: 'candidates'; hits: ExperienceRecallHit[]; source: 'semantic' | 'bm25' }
      | { kind: 'details'; entries: ExperienceEntry[] }>
    /**
     * 提交已使用经验的评价（评价入参的锚点已在工具层收窄；准入判定、入库与统计重算归 domain）。
     * skipped 的原因由 domain 给出，工具层原样透传给模型。
     */
    feedback(input: { caller: { isChild: boolean; sessionId: string; childId?: string }; type: ExperienceType; evaluations: ExperienceFeedbackInput[] }): Promise<ExperienceFeedbackResult>
  }
}

/**
 * 主体类型说明表：键即运行时判据本体。
 * 用 Record<ExperienceType, ...> 而不是字符串数组，是为了让类型联合新增成员时在此处
 * 编译期报错——否则新类型会成为一个「永远无法通过入参校验」的合法类型。
 */
const EXPERIENCE_TYPE_NOTE: Record<ExperienceType, string> = {
  agent: 'experiences of an execution subject: a child agent, or a parent agent that is executing a concrete task right now',
  orchestrator: 'organization experiences of the parent agent that is orchestrating a workflow',
}

/**
 * 经验三工具共用的 subject type 参数说明（措辞单一来源）。
 * 为什么提升到基础设施层：learn / recall / feedback 各写一遍必然出现措辞漂移，
 * 而三者描述的是同一个取值域与同一条「子代理只能 agent」的工具层事实。
 */
export const EXPERIENCE_TYPE_PARAM_DESCRIPTION =
  'Which experience pool this call reads or writes, decided by what you are doing right now: "agent" when you are executing a concrete task yourself, "orchestrator" when you are orchestrating a workflow as its parent agent. A child agent may only pass "agent".'

/** 解析并收窄模型侧 type 参数；未知取值抛 WF_EXPERIENCE_BAD_ARGS（消息给出合法取值）。 */
export function parseExperienceType(raw: unknown): ExperienceType {
  if (typeof raw === 'string' && Object.hasOwn(EXPERIENCE_TYPE_NOTE, raw)) return raw as ExperienceType
  const expected = Object.keys(EXPERIENCE_TYPE_NOTE).map((type) => `"${type}"`).join(' / ')
  throw new WfError(
    `${ERR_EXPERIENCE_BAD_ARGS}: type must be one of ${expected} (received ${JSON.stringify(raw ?? null)}); choose it by what you are doing right now: "agent" when you are executing a concrete task yourself, "orchestrator" when you are orchestrating a workflow as its parent agent`,
    ERR_EXPERIENCE_BAD_ARGS,
  )
}

/**
 * 主体类型归属校验。
 *
 * 为什么只有「子代理只能是 agent」这一条在工具层：调用方是不是子代理是工具层独有的事实
 * （来自官方会话 header），而父代理按此刻执行内容自选类型**没有门禁**——工具层不得再用运行
 * 事实反推父代理身份，也不复制域层的类型判定，避免同一规则两处维护后不一致。
 */
export function assertExperienceTypeOwnership(
  caller: { isChild: boolean; sessionId: string; childId?: string },
  type: ExperienceType,
): void {
  if (!caller.isChild || type === 'agent') return
  throw new WfError(
    `${ERR_EXPERIENCE_WRONG_TYPE}: a child agent may only use type "agent" (received ${JSON.stringify(type)}); child agents are execution subjects, while "orchestrator" experiences belong to the parent agent that is orchestrating`,
    ERR_EXPERIENCE_WRONG_TYPE,
  )
}
