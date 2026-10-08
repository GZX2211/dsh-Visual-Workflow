// tests/host/tools/fixtures/experience-harness.ts
//
// 经验两工具（wf_experience_learn / wf_experience_recall）单测共用的宿主缝 fake：
// 记录每次调用的入参（用于验证工具层是否原样传递调用方身份、类型与映射后的候选），
// 并按用例回放可控结果或失败。工具不落盘，真实持久化由 domain 层承担，故此处只做缝。

import type {
  ExperienceEntry,
  ExperienceGenerationPromptEntry,
  ExperienceRecallHit,
  ExperienceType,
} from '../../../../src/host/shared/asset-types.js'
import type { WfExperienceHost } from '../../../../src/host/tools/infrastructure/experience-contract.js'

/** 调用方身份（与宿主缝逐字同形：工具层不定义命名本体）。 */
interface CallerShape {
  isChild: boolean
  sessionId: string
  childId?: string
}

/** 初始化调用记录。 */
export interface InitializeCall {
  caller: CallerShape
  type: ExperienceType
}

/** 提交调用记录（candidates 为工具映射后的候选数组，形状由 domain 校验）。 */
export interface SubmitCall {
  caller: CallerShape
  type: ExperienceType
  candidates: unknown
}

/** 召回调用记录。 */
export interface RecallCall {
  caller: CallerShape
  type: ExperienceType
  query?: string
  ids?: string[]
  topK?: number
}

/** 召回结果（与宿主缝返回联合同形）。 */
export type RecallReply =
  | { kind: 'candidates'; hits: ExperienceRecallHit[]; source: 'semantic' | 'bm25' }
  | { kind: 'details'; entries: ExperienceEntry[] }

/** 生成 Prompt 样本（active Prompt 的完整投影）。 */
export function generationPromptFixture(type: ExperienceType = 'agent'): ExperienceGenerationPromptEntry {
  return {
    id: `exp-${type}`,
    experienceType: type,
    name: `${type} experience prompt`,
    description: 'generation prompt for tests',
    prompt: `PROMPT BODY FOR ${type}`,
    promptVersion: 'V1',
    active: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

/** 完整经验条目样本（九个语义字段 + 系统生成的检索投影与 provenance）。 */
export function experienceEntryFixture(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: 'ex-1',
    active: true,
    experienceType: 'agent',
    responsibility: '对交付物质量负责',
    taskType: '软件开发',
    decisionDomain: '任务拆分',
    situation: '长流程中出现单点失败',
    trigger: '需要拆大节点时',
    principle: '单一职责节点比大节点更易续跑',
    recommendedAction: '按可独立重跑的最小单元拆节点',
    exclusions: ['节点间强共享状态时'],
    evidence: ['节点 A 失败后只重跑了 A'],
    taskRetrievalText: 'responsibility: 对交付物质量负责',
    decisionRetrievalText: 'decision_domain: 任务拆分',
    sourceRunId: 'run-1',
    generationPromptId: 'exp-agent',
    generationPromptVersion: 'V1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 召回候选样本（summary 由 domain 给出，工具不得重算）。 */
export function recallHitFixture(overrides: Partial<ExperienceRecallHit> = {}): ExperienceRecallHit {
  return {
    id: 'ex-1',
    score: 0.83,
    summary: 'responsibility: 对交付物质量负责 / decision_domain: 任务拆分',
    source: 'semantic',
    ...overrides,
  }
}

/**
 * 宿主缝 fake：默认按请求类型回放对应 Prompt，提交成功、召回返回候选或详情；
 * `*Fail` 非空时抛该值（用例据此验证错误码透传与归一）。
 */
export class FakeExperienceHost implements WfExperienceHost {
  initializeCalls: InitializeCall[] = []
  submitCalls: SubmitCall[] = []
  recallCalls: RecallCall[] = []
  initializeFail: unknown = null
  submitFail: unknown = null
  recallFail: unknown = null
  inserted: ExperienceEntry[] = [experienceEntryFixture()]
  skipped: Array<{ reason: string; decisionRetrievalText: string }> = []
  recallReply: RecallReply = { kind: 'candidates', hits: [recallHitFixture()], source: 'semantic' }

  readonly experience = {
    initializePrompt: async (input: { caller: CallerShape; type: ExperienceType }): Promise<{ prompt: ExperienceGenerationPromptEntry }> => {
      this.initializeCalls.push({ caller: input.caller, type: input.type })
      if (this.initializeFail !== null) {
        const failure = this.initializeFail
        this.initializeFail = null
        throw failure
      }
      return { prompt: generationPromptFixture(input.type) }
    },
    submit: async (input: { caller: CallerShape; type: ExperienceType; candidates: unknown }): Promise<{
      inserted: ExperienceEntry[]
      skipped: Array<{ reason: string; decisionRetrievalText: string }>
    }> => {
      this.submitCalls.push({ caller: input.caller, type: input.type, candidates: input.candidates })
      if (this.submitFail !== null) {
        const failure = this.submitFail
        this.submitFail = null
        throw failure
      }
      return { inserted: this.inserted, skipped: this.skipped }
    },
    recall: async (input: {
      caller: CallerShape
      type: ExperienceType
      query?: string
      ids?: string[]
      topK?: number
    }): Promise<RecallReply> => {
      this.recallCalls.push({
        caller: input.caller,
        type: input.type,
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.ids !== undefined ? { ids: input.ids } : {}),
        ...(input.topK !== undefined ? { topK: input.topK } : {}),
      })
      if (this.recallFail !== null) {
        const failure = this.recallFail
        this.recallFail = null
        throw failure
      }
      return this.recallReply
    },
  }
}
