// tests/client/lib/graph-handles.test.ts
//
// 连接点表与阶段节点标签（模式差异，§4.2.5.1）。

import { describe, expect, it } from 'vitest'
import { HANDLES, defaultInputHandle, defaultOutputHandle, stageLabels, stageTemplateKinds } from '../../../src/client/lib/graph-handles.js'

describe('阶段节点模式差异（§4.2.5.1）', () => {
  it('mode1：启动/结束/暂停', () => {
    expect(stageTemplateKinds('mode1').map((item) => item.label)).toEqual(['启动', '结束', '暂停'])
  })

  it('mode2：输入/输出（无暂停）', () => {
    expect(stageTemplateKinds('mode2').map((item) => item.label)).toEqual(['输入', '输出'])
    expect(stageLabels('mode2').pause).toBe('暂停')
  })
})

describe('连接点表与默认连接点', () => {
  it('输入/输出节点各只有一个流程连接点', () => {
    expect(HANDLES.start.outputs).toEqual(['flow-out'])
    expect(HANDLES.start.inputs).toEqual([])
    expect(HANDLES.end.inputs).toEqual(['flow-in'])
    expect(HANDLES.end.outputs).toEqual([])
  })

  it('默认出/入连接点：按 kind 取最后一个（缺省 agent）', () => {
    expect(defaultOutputHandle('agent')).toBe('flow-out')
    expect(defaultInputHandle('agent')).toBe('flow-in')
    expect(defaultOutputHandle('file')).toBe('ctx-out')
    expect(defaultOutputHandle('database')).toBe('db-out')
    expect(defaultOutputHandle('unknown-kind')).toBe('flow-out')
    expect(defaultInputHandle('unknown-kind')).toBe('flow-in')
  })
})
