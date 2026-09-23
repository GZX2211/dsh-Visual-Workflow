// tests/client/lib/card-geometry.test.ts
//
// 卡片尺寸几何单测（lib/card-geometry.ts —— 卡片尺寸常量与尺寸函数的唯一本体）：
// 阶段节点（启动/结束/暂停）使用紧凑尺寸；角色节点使用标准卡片尺寸；协作组使用自身尺寸。
//
// 注（治理）：本用例原在 tests/client/components/canvas/geometry.test.ts 中，因常量与
// nodeSizeOf 的唯一本体已收敛到 lib/card-geometry.ts，按源文件归属迁至本文件，
// 断言与测试名保持原样。

import { describe, expect, it } from 'vitest'
import { GRAPH_STAGE_SIZE, nodeSizeOf } from '../../../src/client/lib/card-geometry.js'
import type { CanvasNode } from '../../../src/client/studio/studio-state.js'

function nodeOf(id: string, kind: CanvasNode['kind'], extra: Record<string, unknown> = {}): CanvasNode {
  return { id, kind, position: { x: 100, y: 200 }, data: { label: id, ...extra } } as CanvasNode
}

describe('画布几何（协作组/阶段）', () => {
  it('阶段节点使用紧凑尺寸；角色/组使用各自尺寸', () => {
    expect(nodeSizeOf(nodeOf('s', 'start'))).toEqual(GRAPH_STAGE_SIZE)
    expect(nodeSizeOf(nodeOf('e', 'end'))).toEqual(GRAPH_STAGE_SIZE)
    expect(nodeSizeOf(nodeOf('p', 'pause'))).toEqual(GRAPH_STAGE_SIZE)
    expect(nodeSizeOf(nodeOf('a', 'agent'))).toEqual({ w: 208, h: 116 })
  })
})
