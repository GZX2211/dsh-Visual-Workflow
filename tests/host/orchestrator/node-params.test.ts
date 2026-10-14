// tests/host/orchestrator/node-params.test.ts
//
// 节点级参数解析单测（纯函数）：取值优先级与「未设置迭代上限 = 不设限」的回落语义。
// 关键口径：插件不再用自己的私有上限兜底——配置默认 0 表示不设限，迭代由官方运行时行为约束。

import { describe, expect, it } from 'vitest'
import { effectiveReactLimitOf } from '../../../src/host/orchestrator/node-params.js'
import type { RunNodeArgs } from '../../../src/host/orchestrator/run-entry.js'

/** 节点最小形状（只提供解析所需字段；undefined 表示该字段未配置）。 */
function nodeOf(reactLimit: unknown): { data: { label: string; reactLimit: unknown } } {
  return { data: { label: '子任务A', reactLimit } }
}

/** 调用参数最小形状（undefined 表示调用方未传该参数）。 */
function argsOf(iterationLimit: unknown): RunNodeArgs {
  return { nodeId: 'n-a1', iterationLimit }
}

describe('effectiveReactLimitOf：取值优先级（参数 > 节点配置 > 配置默认）', () => {
  it('调用参数优先于节点配置与配置默认', () => {
    expect(effectiveReactLimitOf(nodeOf(5), argsOf(7), 30)).toBe(7)
  })

  it('无调用参数时取节点配置', () => {
    expect(effectiveReactLimitOf(nodeOf(5), argsOf(undefined), 30)).toBe(5)
  })

  it('节点与调用参数均未给时取配置默认（显式配置的全局上限仍然生效）', () => {
    expect(effectiveReactLimitOf(nodeOf(undefined), argsOf(undefined), 30)).toBe(30)
  })

  it('节点显式 null（界面「不设限」）优先于配置默认', () => {
    expect(effectiveReactLimitOf(nodeOf(null), argsOf(undefined), 30)).toBeUndefined()
  })
})

describe('effectiveReactLimitOf：缺省不设限（不再兜底私有上限）', () => {
  it('配置默认 0（不设限）：节点与参数均未设置 → 不设限', () => {
    expect(effectiveReactLimitOf(nodeOf(undefined), argsOf(undefined), 0)).toBeUndefined()
  })

  it('配置默认 0：节点显式 null → 不设限', () => {
    expect(effectiveReactLimitOf(nodeOf(null), argsOf(undefined), 0)).toBeUndefined()
  })

  it('配置默认 0：节点为空串（旧数据/编辑器兜底）→ 不设限', () => {
    expect(effectiveReactLimitOf(nodeOf(''), argsOf(undefined), 0)).toBeUndefined()
  })

  it('非法取值（0 / 负数 / 非数）视为未设置，回落到不设限', () => {
    expect(effectiveReactLimitOf(nodeOf(0), argsOf(0), 0)).toBeUndefined()
    expect(effectiveReactLimitOf(nodeOf(-3), argsOf(-1), 0)).toBeUndefined()
    expect(effectiveReactLimitOf(nodeOf('abc'), argsOf('x'), 0)).toBeUndefined()
  })

  it('下限 1 仍然生效（护栏最小可用取值边界）', () => {
    expect(effectiveReactLimitOf(nodeOf(undefined), argsOf(1), 0)).toBe(1)
    expect(effectiveReactLimitOf(nodeOf(1), argsOf(undefined), 0)).toBe(1)
  })
})
