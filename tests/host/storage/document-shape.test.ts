// tests/host/storage/document-shape.test.ts
//
// 持久化文档最小形状守卫的单元测试：每个资源的守卫必须把「能解析但不是该文档」的值
// 判为不合形状，把真实文档判为合形状；错误类型必须携带文件路径。
// 断言依据：src/host/storage/AGENTS.md「读取语义」（单资源读可诊断、列表读可用）。

import { describe, expect, it } from 'vitest'
import {
  InvalidDocumentError,
  isJsonObject,
  isRunSnapshot,
  isServiceState,
  isSessionIdMap,
  isTemplate,
  isToolComboDocument,
  isWorkflowDocument,
  isWorkflowTemplate,
} from '../../../src/host/storage/document-shape.js'

describe('最小形状守卫', () => {
  it('isJsonObject 只认非 null 的普通对象（标量与数组都不是文档）', () => {
    expect(isJsonObject({ id: 'x' })).toBe(true)
    expect(isJsonObject([])).toBe(false)
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject(undefined)).toBe(false)
    expect(isJsonObject(123)).toBe(false)
    expect(isJsonObject('x')).toBe(false)
    expect(isJsonObject(true)).toBe(false)
  })

  it('文档守卫要求非空字符串 id（缺身份/空串/非字符串都不算该资源文档）', () => {
    const invalid = [{}, { id: 1 }, { id: '' }, { id: '   ' }, [], 'x', 0, null]
    for (const value of invalid) {
      expect(isWorkflowDocument(value), `workflow: ${JSON.stringify(value)}`).toBe(false)
      expect(isServiceState(value), `service: ${JSON.stringify(value)}`).toBe(false)
      expect(isTemplate(value), `template: ${JSON.stringify(value)}`).toBe(false)
      expect(isWorkflowTemplate(value), `flow-template: ${JSON.stringify(value)}`).toBe(false)
      expect(isRunSnapshot(value), `run: ${JSON.stringify(value)}`).toBe(false)
    }
    // 真实文档的最小形态：身份字段在位即通过（未知字段不参与判定，形状漂移不报错）
    expect(isWorkflowDocument({ id: 'f1', sessionId: 's1', nodes: [], lines: [] })).toBe(true)
    expect(isServiceState({ id: 'svc1', sessionId: 's1' })).toBe(true)
    expect(isTemplate({ id: 'r1', name: '角色' })).toBe(true)
    expect(isWorkflowTemplate({ id: 'tpl1' })).toBe(true)
    expect(isRunSnapshot({ id: 'run-1', flowId: 'f1' })).toBe(true)
  })

  it('工具组合守卫要求 combos 为数组（非数组会被读取方展开成垃圾数据）', () => {
    expect(isToolComboDocument({ combos: [] })).toBe(true)
    expect(isToolComboDocument({ combos: [{ id: 'combo-a' }] })).toBe(true)
    expect(isToolComboDocument({ combos: 'combo-a' })).toBe(false)
    expect(isToolComboDocument({})).toBe(false)
    expect(isToolComboDocument([])).toBe(false)
    expect(isToolComboDocument('combo-a')).toBe(false)
  })

  it('会话映射守卫逐值要求字符串（非字符串会以「像真映射」的形态流进会话解析）', () => {
    expect(isSessionIdMap({ u1: 'sess-a' })).toBe(true)
    expect(isSessionIdMap({})).toBe(true)
    expect(isSessionIdMap({ u1: 42 })).toBe(false)
    expect(isSessionIdMap({ u1: null })).toBe(false)
    expect(isSessionIdMap(['sess-a'])).toBe(false)
    expect(isSessionIdMap('sess-a')).toBe(false)
  })
})

describe('InvalidDocumentError', () => {
  it('携带文件路径与可行动文案', () => {
    const error = new InvalidDocumentError('C:\\data\\workflows\\f1.json', '缺少文档身份字段')
    expect(error.name).toBe('InvalidDocumentError')
    expect(error.filePath).toBe('C:\\data\\workflows\\f1.json')
    expect(error.message).toContain('C:\\data\\workflows\\f1.json')
    expect(error.message).toContain('缺少文档身份字段')
  })
})
