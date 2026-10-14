// tests/host/prompts/markers.test.ts
//
// T-005 共享段落标记常量：作为「前缀稳定 + 关键约束双位 + 动态值仅末尾」契约的
// 可测试锚点，必须持续对外导出（各构建器基线与调用方按标记切分输出）。
//
// 断言策略：只锁定标记本身的形状契约（非空、两两互异、在构建器输出中各出现一次），
// 不硬编码提示词正文文案；段落顺序与区段归属由各构建器的基线测试负责。

import { describe, expect, it } from 'vitest'
import {
  HEAD_MARKER,
  MID_MARKER,
  TAIL_MARKER,
  TAIL_RESTATE_MARKER,
  buildNodeTaskBlock,
  buildOrgPlanPrompt,
} from '../../../src/host/prompts/index.js'
import { nodeFacts } from './fixtures/prompt-facts.js'

/** 四个标记的契约：非空、两两互异（否则 indexOf 切分会退化为重复断言）。 */
const MARKERS = { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER }

/** 统计非重叠出现次数（标记为整行锚点，正常输出中应各出现一次）。 */
function occurrences(haystack: string, needle: string): number {
  let count = 0
  let cursor = haystack.indexOf(needle)
  while (cursor >= 0) {
    count += 1
    cursor = haystack.indexOf(needle, cursor + needle.length)
  }
  return count
}

describe('T-005 共享段落标记常量（供测试与后续组装引用）', () => {
  it('导出 TAIL_MARKER / HEAD_MARKER / MID_MARKER / TAIL_RESTATE_MARKER', () => {
    for (const [name, marker] of Object.entries(MARKERS)) {
      expect(typeof marker, name).toBe('string')
      expect(marker.trim().length, name).toBeGreaterThan(0)
    }
  })

  it('四个标记两两互异（切分锚点不可碰撞）', () => {
    const values = Object.values(MARKERS)
    expect(new Set(values).size).toBe(values.length)
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        // 互异性含「一个不得是另一个的子串」：否则 indexOf 会命中错误位置
        expect(values[i].includes(values[j]) || values[j].includes(values[i])).toBe(false)
      }
    }
  })

  it('构建器输出中各标记最多出现一次（重复即切分歧义），且条件注入可区分', () => {
    const outputs: Array<[string, string]> = [
      // 该 params 未给交接契约，故末段重申标记不组装（条件注入，见 node-task 基线测试）
      ['buildNodeTaskBlock', buildNodeTaskBlock({ facts: nodeFacts })],
      ['buildOrgPlanPrompt', buildOrgPlanPrompt({ facts: { target: 'create', targetName: '流水线', systemLanguage: '中文' }, dynamic: { userIntent: 'x' } })],
    ]
    for (const [label, out] of outputs) {
      for (const [name, marker] of Object.entries(MARKERS)) {
        expect(occurrences(out, marker), `${label} 的 ${name} 出现次数`).toBeLessThanOrEqual(1)
      }
    }
    // 未给契约的节点任务块确实不组装重申段（区分「条件注入」与「标记丢失」）
    expect(buildNodeTaskBlock({ facts: nodeFacts })).not.toContain(TAIL_RESTATE_MARKER)
    // 给了契约则重申标记必然出现且唯一
    const withContract = buildNodeTaskBlock({
      facts: { ...nodeFacts, outputContract: '结论 / 产出文件路径' },
    })
    expect(occurrences(withContract, TAIL_RESTATE_MARKER)).toBe(1)
  })
})
