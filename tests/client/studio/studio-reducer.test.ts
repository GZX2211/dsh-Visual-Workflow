// tests/client/studio/studio-reducer.test.ts
//
// 状态机历史栈契约（studio-reducer.ts / studio-initial.ts / studio-snapshot.ts）：
//   ① 跨文档撤销：历史栈严格绑定当前文档，切文档后旧文档的 past/future 都不可被应用；
//   ② 栈上限淘汰：past 到达 HISTORY_LIMIT 后每多一条就淘汰最旧一条，且被淘汰者不可撤销回来；
//   ③ 快照相等判定：UNDO/REDO 两条恢复路径上，dirty 由 graphSnapshotsEqual 判定（内容相等即
//      相等，节点/连线顺序与嵌套字段差异即不相等）；其余分支的 dirty 来自构造赋值或
//      GRAPH_REPLACED 的 action.dirty。
//
// 与 tests/client/studio/studio-state.test.ts 的分工：那里是 P0 跨文档污染的回归套件
// （切文档后 past 清空 + UNDO 不复活旧图），本文件补 future 栈路径、栈上限与判据本体。
// 注：「等价快照不重复入栈」在本实现中**不是**契约——HISTORY_PUSH 无条件入栈，调用方没有
// 值级判重，只有调用点上的频次控制（每次语义变更调用一次 remember），故此处不锁定该假想行为。

import { describe, expect, it } from 'vitest'
import { studioReducer } from '../../../src/client/studio/studio-reducer.js'
import { createInitialState, HISTORY_LIMIT } from '../../../src/client/studio/studio-initial.js'
import { graphSnapshotOf, graphSnapshotsEqual } from '../../../src/client/studio/studio-snapshot.js'
import type { GraphSnapshot, StudioState, CanvasNode } from '../../../src/client/studio/studio-types.js'

function node(id: string): CanvasNode {
  return { id, kind: 'agent', position: { x: 10, y: 10 }, data: { label: id } }
}

/** 一份合法工作流文档（OPEN_FLOW 入参形状，投影后 canvas.nodes 即所给节点）。 */
const flowDoc = (id: string, nodes: CanvasNode[]): never =>
  ({ id, sessionId: 's-1', mode: 'mode1', name: id, description: '', nodes, lines: [] }) as never

/** 打开一个只含给定节点的文档。 */
function opened(nodes: CanvasNode[]): StudioState {
  return studioReducer(createInitialState('s-1'), { type: 'OPEN_FLOW', flow: flowDoc('A', nodes) })
}

/** 由「只含某单个节点」的图构造一份快照（元素互不共享引用，模拟真实入栈）。 */
function snapshotOf(id: string): GraphSnapshot {
  return graphSnapshotOf(studioReducer(createInitialState('s-1'), {
    type: 'GRAPH_REPLACED',
    nodes: [node(id)],
    edges: [],
    dirty: false,
  }))
}

/** 快照里的节点 id 列表（断言用投影）。 */
function idsOf(snapshot: GraphSnapshot): string[] {
  return snapshot.nodes.map((item) => item.id)
}

describe('跨文档撤销：历史栈绑定当前文档', () => {
  it('切文档前 future 非空时，REDO 不得把旧文档的图写进新文档', () => {
    // 文档 A：入栈一份 A 的图 → 再新增节点 → 撤销一步（A 的「编辑后」图进入 future）
    let state = opened([node('a1')])
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_ADDED', node: node('a2') })
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.history.future).toHaveLength(1)

    // 切到文档 B：past 与 future 都必须清空（身份切换入口统一重置）
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('B', [node('b1')]) })
    expect(state.history).toEqual({ past: [], future: [] })

    // 旧文档的 future 不可被应用：REDO 后画布仍是 B 的图
    state = studioReducer(state, { type: 'REDO' })
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['b1'])
    expect(state.currentId).toBe('B')
  })

  it('切文档后连续 UNDO/REDO 均为空操作（栈空不改变画布与文档归属）', () => {
    let state = opened([node('a1')])
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'OPEN_FLOW', flow: flowDoc('B', [node('b1')]) })

    const afterOpen = state
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas).toEqual(afterOpen.canvas)
    state = studioReducer(state, { type: 'REDO' })
    expect(state.canvas).toEqual(afterOpen.canvas)
    expect(state.history).toEqual({ past: [], future: [] })
    expect(state.currentId).toBe('B')
  })
})

describe('历史栈上限（HISTORY_LIMIT）', () => {
  it('恰好到上限不淘汰；超出一条即淘汰最旧条目，且被淘汰者不可撤销回来', () => {
    let state = createInitialState('s-1')
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: snapshotOf(`n-${index}`) })
    }
    // 边界值本身合法：HISTORY_LIMIT 条时一条都不淘汰
    expect(state.history.past).toHaveLength(HISTORY_LIMIT)
    expect(idsOf(state.history.past[0]!)).toEqual(['n-0'])

    const overflow = `n-${HISTORY_LIMIT}`
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: snapshotOf(overflow) })
    expect(state.history.past).toHaveLength(HISTORY_LIMIT)
    expect(idsOf(state.history.past[0]!)).toEqual(['n-1'])
    expect(idsOf(state.history.past.at(-1)!)).toEqual([overflow])

    // 反向证明最旧的 n-0 已被真正淘汰：撤空整个栈，画布停在被淘汰后的最旧快照上
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      state = studioReducer(state, { type: 'UNDO' })
    }
    expect(state.history.past).toEqual([])
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n-1'])
  })

  it('新变更入栈即清空重做栈（新分支取代旧重做路径）', () => {
    let state = opened([node('a1')])
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_ADDED', node: node('a2') })
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.history.future).toHaveLength(1)

    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })

    expect(state.history.future).toEqual([])
    state = studioReducer(state, { type: 'REDO' })
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['a1'])
  })
})

describe('graphSnapshotsEqual：UNDO/REDO 恢复路径上的 dirty 判据', () => {
  it('内容相同但对象实例不同 → 相等（撤销/重做回已保存态不误报未保存）', () => {
    const a = snapshotOf('n1')
    const b = snapshotOf('n1')

    expect(a).not.toBe(b)
    expect(a.nodes[0]).not.toBe(b.nodes[0])
    expect(graphSnapshotsEqual(a, b)).toBe(true)
  })

  it('节点顺序不同 → 不相等（顺序即文档事实源顺序）', () => {
    const state = studioReducer(createInitialState('s-1'), {
      type: 'GRAPH_REPLACED',
      nodes: [node('n1'), node('n2')],
      edges: [],
      dirty: false,
    })
    const forwarded = graphSnapshotOf(state)
    const reversed = graphSnapshotOf({
      ...state,
      canvas: { nodes: [...state.canvas.nodes].reverse(), edges: [] },
    })

    expect(graphSnapshotsEqual(forwarded, reversed)).toBe(false)
  })

  it('嵌套 data 或连线 condition 有差异 → 不相等', () => {
    const state = studioReducer(createInitialState('s-1'), {
      type: 'GRAPH_REPLACED',
      nodes: [node('n1')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'flow-out', targetHandle: 'flow-in' }],
      dirty: false,
    })
    const base = graphSnapshotOf(state)
    const patchedData = graphSnapshotOf(studioReducer(state, { type: 'NODE_DATA_PATCH', id: 'n1', patch: { label: '改名' } }))
    const patchedCondition = graphSnapshotOf(studioReducer(state, {
      type: 'EDGE_PATCH',
      id: 'e1',
      patch: { condition: { type: 'content', label: '路由' } },
    }))

    expect(graphSnapshotsEqual(patchedData, base)).toBe(false)
    expect(graphSnapshotsEqual(patchedCondition, base)).toBe(false)
  })

  it('null 语义：两侧同一个 null 引用相等，任一侧为 null（另侧非 null）即不相等', () => {
    const snapshot = snapshotOf('n1')

    expect(graphSnapshotsEqual(null, null)).toBe(true)
    expect(graphSnapshotsEqual(null, snapshot)).toBe(false)
    expect(graphSnapshotsEqual(snapshot, null)).toBe(false)
  })

  it('REDO 回到已保存态 → dirty=false（判据走结构相等而非引用相等）', () => {
    // 打开 [n1,n2] 即已保存态；新增 n3 后撤销，再删 n3 回到已保存态并入栈
    let state = opened([node('n1'), node('n2')])
    state = studioReducer(state, { type: 'NODE_ADDED', node: node('n3') })
    state = studioReducer(state, { type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
    state = studioReducer(state, { type: 'NODE_REMOVED', id: 'n3' })
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n1', 'n2'])
    state = studioReducer(state, { type: 'UNDO' })
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n1', 'n2', 'n3'])

    state = studioReducer(state, { type: 'REDO' })

    // 重做后的图与 savedGraph 是不同实例但内容相同 → 不得判为未保存
    expect(state.canvas.nodes.map((item) => item.id)).toEqual(['n1', 'n2'])
    expect(state.dirty).toBe(false)
  })
})
