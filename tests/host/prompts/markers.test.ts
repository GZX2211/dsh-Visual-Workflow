// tests/host/prompts/markers.test.ts
//
// T-005 共享段落标记常量：作为「前缀稳定 + 关键约束双位 + 动态值仅末尾」契约的
// 可测试锚点，必须持续对外导出（各构建器基线与调用方按标记切分输出）。

import { describe, expect, it } from 'vitest'
import { HEAD_MARKER, MID_MARKER, TAIL_MARKER, TAIL_RESTATE_MARKER } from '../../../src/host/prompts/index.js'

describe('T-005 共享段落标记常量（供测试与后续组装引用）', () => {
  it('导出 TAIL_MARKER / HEAD_MARKER / MID_MARKER / TAIL_RESTATE_MARKER', () => {
    expect(typeof TAIL_MARKER).toBe('string')
    expect(typeof HEAD_MARKER).toBe('string')
    expect(typeof MID_MARKER).toBe('string')
    expect(typeof TAIL_RESTATE_MARKER).toBe('string')
  })
})
