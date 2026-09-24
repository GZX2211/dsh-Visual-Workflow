// tests/client/lib/graph-edges.test.ts
//
// 连线显示派生（条件标签 / 颜色 class）与「存储连线 → 画布连线」唯一映射。

import { describe, expect, it } from 'vitest'
import { conditionLabel, lineColorClass, lineToCanvasEdge } from '../../../src/client/lib/graph-edges.js'
import type { Line } from '../../../src/host/shared/graph-model.js'

/** 条件标签文案（渲染层从词典注入；测试用中文词典值）。 */
const LABELS = { pass: '通过', fail: '不通过', content: '内容' }

describe('连线标签与颜色', () => {
  it('conditionLabel：通过/不通过/内容（文案来自注入的词典）', () => {
    expect(conditionLabel({ type: 'pass', label: '' }, LABELS)).toBe('[通过]')
    expect(conditionLabel({ type: 'fail', label: '' }, LABELS)).toBe('[不通过]')
    expect(conditionLabel({ type: 'content', label: '路由' }, LABELS)).toBe('[路由]')
    expect(conditionLabel(null, LABELS)).toBe('')
  })

  it('conditionLabel：内容条件无标签时用词典兜底文案；内容超 12 字截断', () => {
    expect(conditionLabel({ type: 'content' }, LABELS)).toBe('[内容]')
    expect(conditionLabel({ type: 'content', label: '一'.repeat(20) }, LABELS)).toBe(`[${'一'.repeat(12)}]`)
  })

  it('conditionLabel：英文词典注入 → 英文标签（lib 不持有用户可见文案）', () => {
    expect(conditionLabel({ type: 'pass' }, { pass: 'Pass', fail: 'Fail', content: 'Content' })).toBe('[Pass]')
  })

  it('lineColorClass：db/ctx/条件/默认', () => {
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'db-out', targetHandle: 'db-in' })).toBe('is-db')
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })).toBe('is-ctx')
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } })).toBe('is-pass')
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })).toBe('')
  })

  it('条件优先于通道：db 通道 + pass 条件 → is-pass（用户显式设条件即按条件着色）', () => {
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'db-out', targetHandle: 'db-in', condition: { type: 'pass' } })).toBe('is-pass')
  })

  it('条件优先于通道：ctx 通道 + content 条件 → is-content', () => {
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in', condition: { type: 'content', label: '路由' } })).toBe('is-content')
  })

  it('未知条件类型不吞通道：db 通道 + 未知条件 → is-db', () => {
    expect(lineColorClass({ id: 'e', source: 'a', target: 'b', sourceHandle: 'db-out', targetHandle: 'db-in', condition: { type: 'other' } as never })).toBe('is-db')
  })
})

describe('lineToCanvasEdge（唯一映射本体）', () => {
  it('条件对象浅拷贝：画布编辑不回流污染文档内对象', () => {
    const line: Line = {
      id: 'e-1', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in',
      condition: { type: 'content', label: '审批' },
    }
    const edge = lineToCanvasEdge(line)
    expect(edge).toEqual(line)
    expect(edge.condition).not.toBe(line.condition)
  })

  it('无条件线不产出 condition 字段（形状最小）', () => {
    const edge = lineToCanvasEdge({ id: 'e-2', source: 'a', target: 'b', sourceHandle: 'flow-out', targetHandle: 'flow-in' })
    expect(Object.prototype.hasOwnProperty.call(edge, 'condition')).toBe(false)
  })

  it('不携带渲染派生字段（颜色/标签由渲染层计算）', () => {
    const edge = lineToCanvasEdge({ id: 'e-3', source: 'a', target: 'b', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }) as unknown as Record<string, unknown>
    expect(edge.lineType).toBeUndefined()
    expect(edge.label).toBeUndefined()
  })
})
