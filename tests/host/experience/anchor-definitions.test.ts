// tests/host/experience/anchor-definitions.test.ts
//
// 评分维度与五级行为锚点的定义本体测试（开发方案 §4 / §5 / §36）。
//
// 为什么这批断言是验收项而不是文档要求：§36 明确要求「所有评分维度拥有明确行为锚点」。
// 若运行期只交给评分者一份合法取值清单，模型仍然会凭感觉在 0.75 与 1 之间挑一个数字，
// 锚点就退化成装饰（§4.1 的设计目的落空）。因此这里既锁定「定义与校验层同源」，
// 也锁定「渲染结果真的能被工具层注入」。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from "vitest"
import {
  DECISION_EFFECT_ANCHORS,
  EVALUATION_DIMENSION_DEFINITIONS,
  EVALUATION_SCORE_FIELDS,
  SCORE_ANCHORS,
  renderAnchorGlossary,
  type EvaluationDimensionDefinition,
} from "../../../src/host/experience/index.js"

/** 唯一跨零维度：其余三维共用 0～1 锚点域。 */
const CROSS_ZERO_DIMENSION = "decisionEffect"

/** 取某一维度的定义（缺失即测试装配错误）。 */
function definitionOf(dimension: string): EvaluationDimensionDefinition {
  const found = EVALUATION_DIMENSION_DEFINITIONS.find((item) => item.dimension === dimension)
  if (!found) throw new Error(`缺少维度定义：${dimension}`)
  return found
}

describe("评分锚点定义本体（§4 / §5 / §36）", () => {
  it("test_四维维度定义_与校验层字段清单完全一致（维度清单只允许一处本体）", () => {
    expect(EVALUATION_DIMENSION_DEFINITIONS.map((item) => item.dimension).sort())
      .toEqual([...EVALUATION_SCORE_FIELDS].sort())
  })

  it("test_每维锚点值域_与常量本体逐值一致（决策效果用跨零域、其余用0到1域）", () => {
    for (const definition of EVALUATION_DIMENSION_DEFINITIONS) {
      const expected = definition.dimension === CROSS_ZERO_DIMENSION
        ? [...DECISION_EFFECT_ANCHORS]
        : [...SCORE_ANCHORS]
      expect(definition.anchors.map((anchor) => anchor.value)).toEqual(expected)
    }
  })

  it("test_每一级锚点都有非空且互不重复的行为定义_且每维给出所回答的问题", () => {
    const seen = new Set<string>()
    for (const definition of EVALUATION_DIMENSION_DEFINITIONS) {
      expect(definition.question.trim().length).toBeGreaterThan(0)
      for (const anchor of definition.anchors) {
        expect(anchor.definition.trim().length).toBeGreaterThan(0)
        // 同一维度内两级不许写成同一句话：复制粘贴会让锚点失去区分力
        const key = `${definition.dimension}:${anchor.definition}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(seen.size).toBe(20)
  })

  it("test_模型侧参数名_与工具入参命名口径一致（snake_case 且逐字固定）", () => {
    expect(EVALUATION_DIMENSION_DEFINITIONS.map((item) => item.parameter).sort())
      .toEqual(["causal_confidence", "decision_effect", "fit", "information_gain"])
    expect(definitionOf("decisionEffect").parameter).toBe("decision_effect")
  })

  it("test_锚点表渲染_覆盖四维参数名与全部锚点值及定义（工具 description 的唯一来源）", () => {
    const glossary = renderAnchorGlossary()
    for (const definition of EVALUATION_DIMENSION_DEFINITIONS) {
      expect(glossary).toContain(definition.parameter)
      for (const anchor of definition.anchors) {
        expect(glossary).toContain(`${anchor.value} = ${anchor.definition}`)
      }
    }
  })

  it("test_锚点表渲染_是纯函数（同样输入两次调用结果完全相同）", () => {
    expect(renderAnchorGlossary()).toBe(renderAnchorGlossary())
  })
})
