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
  ExperienceDuplicateJudge,
  ExperienceEntry,
  ExperienceGenerationPromptEntry,
  ExperienceInsertCheckedInput,
  ExperienceInsertDraft,
  ExperienceInsertRow,
  ExperiencePatch,
  ExperienceRecallHit,
  ExperienceRetrievalUpdate,
  ExperienceType,
} from '../../../src/host/shared/asset-types.js'

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
})
