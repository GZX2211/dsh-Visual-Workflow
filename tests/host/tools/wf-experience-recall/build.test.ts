// tests/host/tools/wf-experience-recall/build.test.ts
//
// 召回输出装配与渲染纯函数单测：
//   - 候选投影只保留契约字段（domain 的额外字段不泄漏给模型），摘要与通道原样透传；
//   - 详情投影保持条目完整性与顺序；
//   - 渲染沿用基础设施的唯一序列化实现（键序稳定，同值同文本）。

import { describe, expect, it } from 'vitest'
import {
  candidateResultOf,
  detailsResultOf,
  renderRecallResult,
} from '../../../../src/host/tools/wf-experience-recall/build.js'
import { experienceEntryFixture, recallHitFixture } from '../fixtures/experience-harness.js'
import type { ExperienceRecallHit } from '../../../../src/host/shared/asset-types.js'

describe('candidateResultOf（候选阶段装配）', () => {
  it('只投影 id / score / summary / source，domain 的额外字段不进入返回体', () => {
    const hit = { ...recallHitFixture(), decisionRetrievalText: '内部检索文本' } as ExperienceRecallHit

    const result = candidateResultOf([hit], 'semantic')

    expect(result).toEqual({
      kind: 'candidates',
      hits: [{ id: 'ex-1', score: 0.83, summary: 'responsibility: 对交付物质量负责 / decision_domain: 任务拆分', source: 'semantic' }],
      source: 'semantic',
    })
    expect(Object.keys(result.hits[0]).sort()).toEqual(['id', 'score', 'source', 'summary'])
  })

  it('保持候选顺序，并原样透传每条的通道标记（不做二次排序或重算）', () => {
    const hits = [recallHitFixture({ id: 'ex-a', source: 'bm25' }), recallHitFixture({ id: 'ex-b', source: 'semantic' })]

    const result = candidateResultOf(hits, 'bm25')

    expect(result.hits.map((entry) => entry.id)).toEqual(['ex-a', 'ex-b'])
    expect(result.hits.map((entry) => entry.source)).toEqual(['bm25', 'semantic'])
    expect(result.source).toBe('bm25')
  })
})

describe('detailsResultOf（详情阶段装配）', () => {
  it('完整条目原样返回并保持顺序', () => {
    const first = experienceEntryFixture({ id: 'ex-1' })
    const second = experienceEntryFixture({ id: 'ex-2' })

    const result = detailsResultOf([first, second])

    expect(result).toEqual({ kind: 'details', entries: [first, second] })
  })
})

describe('renderRecallResult（渲染）', () => {
  it('沿用统一稳定序列化：键序稳定、字符串原样', () => {
    const value = candidateResultOf([recallHitFixture()], 'semantic')

    const [block] = renderRecallResult({}, value)

    expect(block.type).toBe('text')
    expect(block.text).toBe(
      '{"hits":[{"id":"ex-1","score":0.83,"source":"semantic","summary":"responsibility: 对交付物质量负责 / decision_domain: 任务拆分"}],"kind":"candidates","source":"semantic"}',
    )
    expect(renderRecallResult({}, value)[0].text).toBe(block.text)
  })
})
