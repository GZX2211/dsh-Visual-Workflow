// tests/host/tools/infrastructure/text-render.test.ts
//
// 工具输出渲染（text-render.ts）单测：键序稳定序列化、嵌套与数组语义、
// 字符串原样输出、undefined 剔除与 null 归一。

import { describe, expect, it } from 'vitest'
import { stableStringify, textRender } from '../../../../src/host/tools/infrastructure/text-render.js'

describe('textRender 键序稳定', () => {
  it('同一对象不同插入序输出一致（键序稳定）', () => {
    const a = stableStringify({ nodeId: 'n1', status: 'ok', childId: 'c1' })
    const b = stableStringify({ childId: 'c1', status: 'ok', nodeId: 'n1' })
    expect(a).toBe(b)
    expect(a).toBe('{"childId":"c1","nodeId":"n1","status":"ok"}')
  })

  it('嵌套对象同样按键排序；数组保持元素顺序', () => {
    const out = stableStringify({ answers: [{ selected: [], id: 'q1' }, { id: 'q2', selected: ['a'] }], ok: true })
    expect(out).toBe('{"answers":[{"id":"q1","selected":[]},{"id":"q2","selected":["a"]}],"ok":true}')
  })

  it('字符串值原样输出；undefined 字段剔除；null 归一', () => {
    expect(textRender({}, 'hello').at(0)?.text).toBe('hello')
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(stableStringify(undefined)).toBe('null')
  })
})
