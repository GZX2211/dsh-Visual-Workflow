// tests/host/storage/document-policy.test.ts
//
// 写入策略纯函数测试（T-012 拆分）：客户端快照字段剥除与 revision 记账/乐观锁。
// 断言依据：src/host/storage/AGENTS.md「时间戳与版本」「兼容与退役字段」。
//
// 运行环境：node（host 测试默认）；本文件不触盘（纯函数，除类型外零依赖）。

import { describe, expect, it } from 'vitest'
import {
  FlowRevisionConflictError,
  flowRevision,
  keepServerFieldsOf,
  nextFlowRevision,
  stripClientMeta,
} from '../../../src/host/storage/document-policy.js'

const PATCH = { origin: 'agent' as const, at: '2026-09-01T00:00:00.000Z', nodeIds: ['a'] }

describe('stripClientMeta 客户端快照剥除', () => {
  it('始终剥除前端临时标记（_draft / _clientMeta）', () => {
    const input = { id: 'a', name: 'n', _draft: true, _clientMeta: { x: 1 } }
    expect(stripClientMeta(input)).toEqual({ id: 'a', name: 'n' })
  })

  it('缺省剥除服务端字段 lastPatch（用户保存语义）', () => {
    expect(stripClientMeta({ id: 'a', lastPatch: PATCH })).toEqual({ id: 'a' })
  })

  it('keepServerFields=true 时保留 lastPatch（代理补丁路径）', () => {
    expect(stripClientMeta({ id: 'a', lastPatch: PATCH, _draft: true }, true)).toEqual({ id: 'a', lastPatch: PATCH })
  })

  it('返回浅拷贝：不修改入参', () => {
    const input = { id: 'a', _draft: true }
    const out = stripClientMeta(input)
    expect(out).not.toBe(input)
    expect(input).toEqual({ id: 'a', _draft: true })
  })

  it('非对象入参原样返回（null / 数组 / 标量）', () => {
    expect(stripClientMeta(null)).toBeNull()
    const arr = [1, 2]
    expect(stripClientMeta(arr)).toBe(arr)
    expect(stripClientMeta('x')).toBe('x')
  })
})

describe('keepServerFieldsOf 选项解析', () => {
  it('缺省 false，仅显式 true 才保留', () => {
    expect(keepServerFieldsOf(undefined)).toBe(false)
    expect(keepServerFieldsOf({})).toBe(false)
    expect(keepServerFieldsOf({ keepServerFields: false })).toBe(false)
    expect(keepServerFieldsOf({ keepServerFields: true })).toBe(true)
  })
})

describe('flowRevision 提取', () => {
  it('非负整数原样返回，其余按 0 处理（旧数据兼容）', () => {
    expect(flowRevision({ revision: 3 })).toBe(3)
    expect(flowRevision({ revision: 0 })).toBe(0)
    expect(flowRevision(null)).toBe(0)
    expect(flowRevision({})).toBe(0)
    expect(flowRevision({ revision: -1 })).toBe(0)
    expect(flowRevision({ revision: 1.5 })).toBe(0)
    expect(flowRevision({ revision: Number.NaN })).toBe(0)
  })
})

describe('nextFlowRevision 记账与乐观锁', () => {
  it('首次保存（无既有文档）revision=1', () => {
    expect(nextFlowRevision({ id: 'a' }, null)).toBe(1)
  })

  it('无显式期望：在既有 revision 上 +1', () => {
    expect(nextFlowRevision({ id: 'a' }, { revision: 2 })).toBe(3)
    expect(nextFlowRevision({ id: 'a' }, { revision: 2 }, { expectedRevision: null })).toBe(3)
  })

  it('显式期望匹配：+1；不匹配：抛冲突（不写盘）', () => {
    expect(nextFlowRevision({ id: 'a' }, { revision: 2 }, { expectedRevision: 2 })).toBe(3)
    expect(() => nextFlowRevision({ id: 'a' }, { revision: 2 }, { expectedRevision: 1 })).toThrow(FlowRevisionConflictError)
  })

  it('force=true 跳过冲突检查（仍 +1）', () => {
    expect(nextFlowRevision({ id: 'a' }, { revision: 2 }, { expectedRevision: 1, force: true })).toBe(3)
  })

  it('冲突错误带稳定 code 与上下文（id / 期望 / 实际）', () => {
    try {
      nextFlowRevision({ id: 'wf-1' }, { revision: 5 }, { expectedRevision: 4 })
      throw new Error('应当抛出冲突')
    } catch (error) {
      const conflict = error as FlowRevisionConflictError
      expect(conflict).toBeInstanceOf(FlowRevisionConflictError)
      expect(conflict.name).toBe('FlowRevisionConflictError')
      expect(conflict.code).toBe('FLOW_REVISION_CONFLICT')
      expect(conflict.id).toBe('wf-1')
      expect(conflict.expectedRevision).toBe(4)
      expect(conflict.actualRevision).toBe(5)
      expect(conflict.message).toContain('wf-1')
    }
  })
})
