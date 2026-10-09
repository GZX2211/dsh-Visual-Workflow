// tests/host/shared/asset-types.test.ts
//
// 共享契约：Experience V1 协议形状门。
//
// 为什么用「编译期守卫 + 少量运行期断言」而不是只做 JSON 快照：
// ExperienceEntry 是磁盘行的对外投影，字段增删会直接波及 Host 持久化、API 边界与
// Client 面板三处；编译期守卫保证三处消费的形状与契约本体一致，运行期断言只用来锁定
// 「两边命名口径不同」这一事实（客户端 camelCase / 模型侧 snake_case 由工具层映射）。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import type {
  ExperienceDecisionEffectAnchor,
  ExperienceDuplicateJudge,
  ExperienceEntry,
  ExperienceEvaluationEntry,
  ExperienceEvaluationInsert,
  ExperienceGenerationPromptEntry,
  ExperienceInsertCheckedInput,
  ExperienceInsertDraft,
  ExperienceInsertRow,
  ExperiencePatch,
  ExperienceRecallHit,
  ExperienceRetrievalUpdate,
  ExperienceScoreAnchor,
  ExperienceStatsAggregate,
  ExperienceStatsEntry,
  ExperienceType,
  ExperienceUsageEntry,
  ExperienceUsageInsert,
  NeutralStatsValues,
} from '../../../src/host/shared/asset-types.js'

/** 五级评分锚点（运行期取值域的唯一本体在经验域常量，此处只锁定类型层写法）。 */
const _scoreAnchors: readonly ExperienceScoreAnchor[] = [0, 0.25, 0.5, 0.75, 1]

/** 决策效果锚点（唯一跨零维度）。 */
const _effectAnchors: readonly ExperienceDecisionEffectAnchor[] = [-1, -0.5, 0, 0.5, 1]

/** 经验主体类型取值域（三类主体，与文档「agent / team / orchestrator」逐字一致）。 */
const _experienceTypes: readonly ExperienceType[] = ['agent', 'team', 'orchestrator']

/** 完整经验条目最小形状（磁盘行的对外投影）。 */
const _entry: ExperienceEntry = {
  id: 'ex-1',
  active: true,
  experienceType: 'agent',
  responsibility: '对节点任务的正确性负责',
  taskType: '软件开发',
  decisionDomain: '任务分解',
  situation: '两个节点表面独立但共享未稳定的前置条件',
  trigger: '准备把多个节点并行启动时',
  principle: '共享前置条件未稳定时并行会放大返工',
  recommendedAction: '先建立显式完成闸门再并行',
  exclusions: ['前置条件已由上游完全固化'],
  evidence: ['并行启动后出现重复返工'],
  taskRetrievalText: 'responsibility: 对节点任务的正确性负责',
  decisionRetrievalText: 'decision_domain: 任务分解',
  sourceRunId: 'run-1',
  generationPromptId: 'ep-1',
  generationPromptVersion: 'V1',
  createdAt: 1,
  updatedAt: 2,
}

/** 候选经验最小形状（模型提交侧；provenance 由系统补充，不在 draft 内）。 */
const _draft: ExperienceInsertDraft = {
  experienceType: 'team',
  responsibility: '对协作结果负责',
  taskType: '软件开发',
  decisionDomain: '协作同步',
  situation: '成员基于旧状态继续执行',
  trigger: '状态发生变化时',
  principle: '状态未同步会放大重复工作',
  recommendedAction: '状态变更后主动通知受影响成员',
  exclusions: ['成员之间无依赖'],
  evidence: ['某成员基于旧状态产出被丢弃'],
}

/** Prompt 表投影最小形状。 */
const _prompt: ExperienceGenerationPromptEntry = {
  id: 'ep-1',
  experienceType: 'orchestrator',
  name: 'Orchestration Experience Generation Prompt',
  prompt: '正文',
  promptVersion: 'V1',
  active: true,
  createdAt: 1,
  updatedAt: 1,
}

/** 召回候选最小形状。 */
const _hit: ExperienceRecallHit = { id: 'ex-1', score: 0.9, summary: '责任 / 决策域 / 边界 / 情境', source: 'semantic' }

/** 可编辑字段补丁（undefined = 不改；null 仅用于数组清空）。 */
const _patch: ExperiencePatch = { responsibility: '新责任', exclusions: null }

/** 写库行（系统补全 provenance 与向量后的完整行事实）。 */
const _row: ExperienceInsertRow = {
  ..._draft,
  id: 'ex-2',
  taskRetrievalText: 'responsibility: 对协作结果负责',
  taskEmbedding: new Float64Array([1, 0]),
  decisionRetrievalText: 'decision_domain: 协作同步',
  decisionEmbedding: new Float64Array([0, 1]),
  embeddingModel: 'bge-small-zh-v1.5',
  embeddingDimension: 2,
  sourceRunId: 'run-2',
  generationPromptId: 'ep-2',
  generationPromptVersion: 'V1',
}

/** 判重判据（纯函数，由经验域注入资产库）。 */
const _duplicateOf: ExperienceDuplicateJudge = (candidate, existing) =>
  candidate.decisionEmbedding[0] === existing.decisionEmbedding[0]
    ? { duplicate: true, reason: '语义核心与既有经验重合' }
    : { duplicate: false }

/** 判重写入入参（判定与写入同一事务）。 */
const _checked: ExperienceInsertCheckedInput = { rows: [_row], duplicateOf: _duplicateOf }

/** 编辑保存时一并刷新的检索投影与向量（事务外算好）。 */
const _retrieval: ExperienceRetrievalUpdate = {
  taskRetrievalText: 'responsibility: 更新后的责任',
  decisionRetrievalText: 'decision_domain: 更新后的决策域',
  taskEmbedding: new Float64Array([1]),
  decisionEmbedding: new Float64Array([1]),
  embeddingModel: 'bge-small-zh-v1.5',
  embeddingDimension: 1,
}

/** 统计投影最小形状（可重建的派生结果，不是经验本体）。 */
const _stats: ExperienceStatsEntry = {
  experienceId: 'ex-1',
  effectiveSampleCount: 0,
  recalledCount: 0,
  usedCount: 0,
  fitMean: 0,
  empiricalValue: 0,
  variance: 0,
  stability: 1,
  evidenceStrength: 0,
  harmCount: 0,
  harmRate: 0,
  harmSeverity: 0,
  qualitySignal: 0,
  trust: 0.5,
  updatedAt: 1,
}

/** 评价写入行（四个维度只能取五级锚点；行 id 由资产库发号，不在写入行内）。 */
const _evaluation: ExperienceEvaluationInsert = {
  experienceId: 'ex-1',
  runId: 'run-1',
  fitScore: 0.75,
  decisionEffect: 0.5,
  informationGain: 0.75,
  causalConfidence: 0.75,
  evidence: '该经验直接影响了并行/串行选择',
  evaluatorSubjectId: 'child-1',
  evaluatorModel: 'test-model',
}

/** 使用事实写入行（「被显式注入 agent 上下文」这一事实；行 id 同由资产库发号）。 */
const _usage: ExperienceUsageInsert = {
  experienceId: 'ex-1',
  runId: 'run-1',
  subjectId: 'child-1',
}

/** 读回的历史行才带记账字段（id / createdAt 属资产库记账）。 */
const _evaluationEntry: ExperienceEvaluationEntry = { ..._evaluation, id: 'ev-1', createdAt: 1 }
const _usageEntry: ExperienceUsageEntry = { ..._usage, id: 'us-1', createdAt: 1 }

/** 聚合器（纯函数；资产库只保证事务边界，公式由经验域注入）。 */
const _aggregate: ExperienceStatsAggregate = (input) => ({
  effectiveSampleCount: input.evaluations.length,
  recalledCount: input.recalledCount,
  usedCount: input.evaluations.length,
  fitMean: 0,
  empiricalValue: 0,
  variance: 0,
  stability: 1,
  evidenceStrength: 0,
  harmCount: 0,
  harmRate: 0,
  harmSeverity: 0,
  qualitySignal: 0,
  trust: 0.5,
})

/** 中性统计投影（缺 recalledCount：由资产库按本批使用条数填入）。 */
const _neutral: NeutralStatsValues = {
  effectiveSampleCount: 0,
  usedCount: 0,
  fitMean: 0,
  empiricalValue: 0,
  variance: 0,
  stability: 1,
  evidenceStrength: 0,
  harmCount: 0,
  harmRate: 0,
  harmSeverity: 0,
  qualitySignal: 0,
  trust: 0.5,
}

describe('shared/asset-types Experience V1 契约形态', () => {
  it('经验主体类型只有三类（agent / team / orchestrator）', () => {
    expect(_experienceTypes).toEqual(['agent', 'team', 'orchestrator'])
    expect(_entry.experienceType).toBe('agent')
  })

  it('经验条目携带九个语义字段与两个检索投影文本', () => {
    expect(_entry.responsibility).toBeTruthy()
    expect(_entry.taskType).toBe('软件开发')
    expect(_entry.decisionDomain).toBe('任务分解')
    expect(_entry.situation).toBeTruthy()
    expect(_entry.trigger).toBeTruthy()
    expect(_entry.principle).toBeTruthy()
    expect(_entry.recommendedAction).toBeTruthy()
    expect(_entry.exclusions).toHaveLength(1)
    expect(_entry.evidence).toHaveLength(1)
    expect(_entry.taskRetrievalText).toContain('responsibility')
    expect(_entry.decisionRetrievalText).toContain('decision_domain')
  })

  it('经验条目携带 provenance 与 lifecycle 事实（模型不得伪造）', () => {
    expect(_entry.sourceRunId).toBe('run-1')
    expect(_entry.generationPromptId).toBe('ep-1')
    expect(_entry.generationPromptVersion).toBe('V1')
    expect(_entry.createdAt).toBe(1)
    expect(_entry.updatedAt).toBe(2)
    // 向量元信息是可选列（无向量能力的历史行同样可读）
    expect(_entry.embeddingModel).toBeUndefined()
    expect(_entry.embeddingDimension).toBeUndefined()
  })

  it('候选草稿不含 provenance 字段（由系统按主体解析结果补充）', () => {
    expect(Object.keys(_draft).sort()).toEqual([
      'decisionDomain', 'evidence', 'exclusions', 'experienceType', 'principle',
      'recommendedAction', 'responsibility', 'situation', 'taskType', 'trigger',
    ])
  })

  it('Prompt 投影携带唯一 active 语义与版本', () => {
    expect(_prompt.active).toBe(true)
    expect(_prompt.promptVersion).toBe('V1')
    expect(_prompt.experienceType).toBe('orchestrator')
  })

  it('召回候选携带 score / summary / 检索来源标记', () => {
    expect(_hit.source).toBe('semantic')
    expect(_hit.score).toBeGreaterThan(0)
    expect(_hit.summary).toBeTruthy()
  })

  it('补丁以 undefined 表达「本次不改」、以 null 表达「清空数组」', () => {
    expect(_patch.exclusions).toBeNull()
    expect(_patch.evidence).toBeUndefined()
    expect(_patch.responsibility).toBe('新责任')
  })

  it('写库行在语义字段之外携带向量本体与 provenance', () => {
    expect(_row.taskEmbedding).toHaveLength(2)
    expect(_row.decisionEmbedding).toHaveLength(2)
    expect(_row.embeddingDimension).toBe(2)
    expect(_row.sourceRunId).toBe('run-2')
    expect(_row.generationPromptId).toBe('ep-2')
  })

  it('判重判据由调用方注入且返回可直接呈现的原因', () => {
    const verdict = _checked.duplicateOf(
      { experienceType: 'team', decisionEmbedding: new Float64Array([1, 0]), decisionRetrievalText: 'a' },
      { id: 'ex-9', decisionEmbedding: new Float64Array([1, 0]), decisionRetrievalText: 'b' },
    )
    expect(verdict.duplicate).toBe(true)
    if (verdict.duplicate) expect(verdict.reason).toBeTruthy()
    const notDuplicate = _checked.duplicateOf(
      { experienceType: 'team', decisionEmbedding: new Float64Array([0, 1]), decisionRetrievalText: 'a' },
      { id: 'ex-9', decisionEmbedding: new Float64Array([1, 0]), decisionRetrievalText: 'b' },
    )
    expect(notDuplicate.duplicate).toBe(false)
  })

  it('编辑保存的检索刷新载荷自带投影文本与两个向量', () => {
    expect(_retrieval.taskRetrievalText).toContain('responsibility')
    expect(_retrieval.decisionRetrievalText).toContain('decision_domain')
    expect(_retrieval.taskEmbedding).toHaveLength(1)
    expect(_retrieval.decisionEmbedding).toHaveLength(1)
  })

  it('评分锚点只有五级（fit / information_gain / causal_confidence），决策效果允负值', () => {
    expect(_scoreAnchors).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(_effectAnchors).toEqual([-1, -0.5, 0, 0.5, 1])
    // 决策效果是唯一跨零维度，其余三维不得为负
    expect(_scoreAnchors.every((value) => value >= 0)).toBe(true)
  })

  it('评价写入行携带四维锚点与评分者 provenance（评分者模型允许空串）', () => {
    expect(_evaluation.fitScore).toBe(0.75)
    expect(_evaluation.decisionEffect).toBe(0.5)
    expect(_evaluation.informationGain).toBe(0.75)
    expect(_evaluation.causalConfidence).toBe(0.75)
    expect(_evaluation.evaluatorSubjectId).toBe('child-1')
    expect(_evaluation.evaluatorModel).toBe('test-model')
  })

  it('统计投影是派生结果：十三项数值 + 主键 + 记账时间，其中 trust 中性为 0.5', () => {
    expect(_stats.experienceId).toBe('ex-1')
    expect(_stats.trust).toBe(0.5)
    expect(_stats.stability).toBe(1)
    expect(_stats.qualitySignal).toBe(0)
    const numericKeys = Object.keys(_stats).filter((key) => key !== 'experienceId' && key !== 'updatedAt')
    expect(numericKeys.sort()).toEqual([
      'effectiveSampleCount', 'empiricalValue', 'evidenceStrength', 'fitMean', 'harmCount',
      'harmRate', 'harmSeverity', 'qualitySignal', 'recalledCount', 'stability', 'trust',
      'usedCount', 'variance',
    ])
  })

  it('使用事实携带被注入的主体与运行（统计 recalled_count 的唯一来源）', () => {
    expect(_usage.experienceId).toBe('ex-1')
    expect(_usage.subjectId).toBe('child-1')
    expect(_usage.runId).toBe('run-1')
  })

  it('写入行不含记账字段：id / createdAt 只在读回的历史行上（发号属资产库契约）', () => {
    expect(Object.keys(_evaluation).sort()).toEqual([
      'causalConfidence', 'decisionEffect', 'evaluatorModel', 'evaluatorSubjectId',
      'evidence', 'experienceId', 'fitScore', 'informationGain', 'runId',
    ])
    expect(Object.keys(_usage).sort()).toEqual(['experienceId', 'runId', 'subjectId'])
    expect(_evaluationEntry.id).toBe('ev-1')
    expect(_usageEntry.createdAt).toBe(1)
  })

  it('聚合器是纯闭包：读入评价历史与 recalledCount，产出统计数值（资产库只保证事务）', () => {
    const values = _aggregate({
      evaluations: [{ fitScore: 1, decisionEffect: 1, informationGain: 1, causalConfidence: 1 }],
      recalledCount: 4,
    })
    expect(values.usedCount).toBe(1)
    expect(values.recalledCount).toBe(4)
    expect(Object.keys(_neutral)).not.toContain('recalledCount')
  })

  it('经验条目上的 stats 是可选字段（无统计行即省略，读侧按中性解释）', () => {
    expect(_entry.stats).toBeUndefined()
    expect({ ..._entry, stats: _stats }.stats?.experienceId).toBe('ex-1')
  })
})
