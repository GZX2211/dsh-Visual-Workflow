// tests/client/run-locks.test.ts
//
// 运行中实例画布锁定纯逻辑单测：已完成（ok / react-capped）与执行中（running）节点
// 及其连线的锁定矩阵、fail 不锁、虚拟节点归主判锁、canConnect 允许/拒绝分支。

import { describe, expect, it } from 'vitest'
import { computeRunLocks } from '../../src/client/lib/run-locks.js'
import type { RunLockInput } from '../../src/client/lib/run-locks.js'
import type { CanvasEdge, CanvasNode } from '../../src/client/studio/studio-state.js'

/** 画布节点工厂（默认角色节点）。 */
const node = (id: string, kind: CanvasNode['kind'] = 'agent'): CanvasNode => ({
  id, kind, position: { x: 0, y: 0 }, data: { label: id },
})

/** 虚拟节点工厂（proxySourceId 承载主节点引用，位于节点顶层）。 */
const proxy = (id: string, proxySourceId?: string): CanvasNode =>
  ({ id, kind: 'proxy', position: { x: 0, y: 0 }, data: {}, ...(proxySourceId === undefined ? {} : { proxySourceId }) }) as CanvasNode

/** 画布连线工厂（流程线）。 */
const edge = (id: string, source: string, target: string): CanvasEdge => ({
  id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in',
})

/** 锁定判定入参工厂（默认启用锁定）。 */
const input = (nodes: CanvasNode[], edges: CanvasEdge[], statusByNode: Record<string, string>, enabled = true): RunLockInput =>
  ({ enabled, nodes, edges, statusByNode })

describe('未启用 / 无状态：全部解锁', () => {
  const nodes = [node('a'), node('b')]
  const edges = [edge('e1', 'a', 'b')]

  it('enabled=false：空集 + 谓词全 false + canConnect 恒 true（既有 ok/running 状态一律忽略）', () => {
    const locks = computeRunLocks(input(nodes, edges, { a: 'ok', b: 'running' }, false))
    expect(locks.lockedNodeIds.size).toBe(0)
    expect(locks.lockedEdgeIds.size).toBe(0)
    expect(locks.isNodeLocked('a')).toBe(false)
    expect(locks.isEdgeLocked('e1')).toBe(false)
    expect(locks.isNodeCompleted('a')).toBe(false)
    expect(locks.isNodeRunning('b')).toBe(false)
    expect(locks.canConnect('a', 'b')).toBe(true)
  })

  it('enabled=true 但快照无登记：无状态 = 既非 completed 也非 running', () => {
    const locks = computeRunLocks(input(nodes, edges, {}))
    expect(locks.lockedNodeIds.size).toBe(0)
    expect(locks.lockedEdgeIds.size).toBe(0)
    expect(locks.isNodeCompleted('a')).toBe(false)
    expect(locks.isNodeRunning('a')).toBe(false)
    expect(locks.canConnect('a', 'b')).toBe(true)
  })

  it('pending / armed 等同未完成：不锁节点与连线', () => {
    const locks = computeRunLocks(input([node('p'), node('q')], [edge('e1', 'p', 'q')], { p: 'pending', q: 'armed' }))
    expect(locks.lockedNodeIds.size).toBe(0)
    expect(locks.lockedEdgeIds.size).toBe(0)
  })
})

describe('已完成节点（ok / react-capped）', () => {
  it('ok 节点自身被锁，其全部入线与出线被锁', () => {
    const nodes = [node('s'), node('a'), node('b')]
    const edges = [edge('e-in', 's', 'a'), edge('e-out', 'a', 'b')]
    const locks = computeRunLocks(input(nodes, edges, { s: 'pending', a: 'ok', b: 'pending' }))
    expect(locks.isNodeCompleted('a')).toBe(true)
    expect(locks.isNodeLocked('a')).toBe(true)
    expect([...locks.lockedNodeIds]).toEqual(['a'])
    expect(locks.lockedEdgeIds.has('e-in')).toBe(true)
    expect(locks.lockedEdgeIds.has('e-out')).toBe(true)
  })

  it('react-capped 与 ok 同等（已完成）', () => {
    const locks = computeRunLocks(input([node('a'), node('b')], [edge('e1', 'a', 'b')], { a: 'react-capped', b: 'pending' }))
    expect(locks.isNodeCompleted('a')).toBe(true)
    expect(locks.isNodeLocked('a')).toBe(true)
    expect(locks.isEdgeLocked('e1')).toBe(true)
  })

  it('两端都已完成时连线仍被锁（出线锁与入线锁任一成立即锁）', () => {
    const locks = computeRunLocks(input([node('a'), node('b')], [edge('e1', 'a', 'b')], { a: 'ok', b: 'react-capped' }))
    expect(locks.isEdgeLocked('e1')).toBe(true)
  })

  it('未完成节点之间的连线不锁（画布其余部分可改）', () => {
    const locks = computeRunLocks(input([node('a'), node('b')], [edge('e1', 'a', 'b')], { a: 'pending', b: 'fail' }))
    expect(locks.isEdgeLocked('e1')).toBe(false)
  })
})

describe('失败节点不锁（需求明确要求）', () => {
  it('fail 节点不被锁，其入线/出线均不锁', () => {
    const nodes = [node('a'), node('f'), node('b')]
    const edges = [edge('e-in', 'a', 'f'), edge('e-out', 'f', 'b')]
    const locks = computeRunLocks(input(nodes, edges, { a: 'ok', f: 'fail', b: 'pending' }))
    expect(locks.isNodeCompleted('f')).toBe(false)
    expect(locks.isNodeRunning('f')).toBe(false)
    expect(locks.isNodeLocked('f')).toBe(false)
    // 入线源为已完成（a: ok）→ 该入线仍锁；出线（f→b，两端未完成）不锁
    expect(locks.isEdgeLocked('e-in')).toBe(true)
    expect(locks.isEdgeLocked('e-out')).toBe(false)
  })
})

describe('执行中节点（running）：左入锁、右出不锁', () => {
  const nodes = [node('a'), node('r'), node('b')]
  const edges = [edge('e-in', 'a', 'r'), edge('e-out', 'r', 'b')]

  it('节点自身在 lockedNodeIds，左侧入口线锁，右侧出线不锁', () => {
    const locks = computeRunLocks(input(nodes, edges, { a: 'pending', r: 'running', b: 'pending' }))
    expect(locks.isNodeRunning('r')).toBe(true)
    expect(locks.isNodeLocked('r')).toBe(true)
    expect(locks.isNodeCompleted('r')).toBe(false)
    expect(locks.lockedEdgeIds.has('e-in')).toBe(true)
    expect(locks.lockedEdgeIds.has('e-out')).toBe(false)
  })

  it('执行中节点的入线即使源为失败/无状态也锁（仅看目标状态）', () => {
    const locks = computeRunLocks(input(nodes, edges, { r: 'running' }))
    expect(locks.isEdgeLocked('e-in')).toBe(true)
    expect(locks.isEdgeLocked('e-out')).toBe(false)
  })
})

describe('虚拟节点（proxy）按主节点状态判锁', () => {
  it('主节点已完成：proxy 自身被锁，且与其相连的入线/出线按主节点状态锁', () => {
    const nodes = [node('m'), proxy('x', 'm'), node('p'), node('q')]
    const edges = [edge('e-in', 'p', 'x'), edge('e-out', 'x', 'q')]
    const locks = computeRunLocks(input(nodes, edges, { m: 'ok', p: 'pending', q: 'pending' }))
    expect(locks.isNodeCompleted('x')).toBe(true)
    expect(locks.isNodeLocked('x')).toBe(true)
    expect(locks.isNodeLocked('m')).toBe(true)
    expect(locks.isEdgeLocked('e-in')).toBe(true)
    expect(locks.isEdgeLocked('e-out')).toBe(true)
  })

  it('主节点执行中：proxy 被锁，其左侧入口线锁、右出线不锁', () => {
    const nodes = [node('m'), proxy('x', 'm'), node('p'), node('q')]
    const edges = [edge('e-in', 'p', 'x'), edge('e-out', 'x', 'q')]
    const locks = computeRunLocks(input(nodes, edges, { m: 'running', p: 'pending', q: 'pending' }))
    expect(locks.isNodeRunning('x')).toBe(true)
    expect(locks.isEdgeLocked('e-in')).toBe(true)
    expect(locks.isEdgeLocked('e-out')).toBe(false)
  })

  it('主节点未完成 / 无状态：proxy 不锁', () => {
    const pendingLocks = computeRunLocks(input([node('m'), proxy('x', 'm')], [], { m: 'pending' }))
    expect(pendingLocks.isNodeLocked('x')).toBe(false)
    const noStatusLocks = computeRunLocks(input([node('m'), proxy('x', 'm')], [], {}))
    expect(noStatusLocks.isNodeLocked('x')).toBe(false)
  })

  it('proxy 无 proxySourceId（非字符串）→ 退化为按自身 id 查状态', () => {
    const locks = computeRunLocks(input([node('m'), proxy('x')], [], { m: 'pending', x: 'ok' }))
    expect(locks.isNodeCompleted('x')).toBe(true)
    expect(locks.isNodeLocked('x')).toBe(true)
  })

  it('proxySourceId 指向画布外/未登记节点 → 无状态（不锁）', () => {
    const locks = computeRunLocks(input([proxy('x', 'ghost')], [], {}))
    expect(locks.isNodeCompleted('x')).toBe(false)
    expect(locks.isNodeLocked('x')).toBe(false)
  })

  it('主节点自身（非 proxy）状态独立登记：同状态集合内各算各的', () => {
    const nodes = [node('m'), proxy('x', 'm')]
    const locks = computeRunLocks(input(nodes, [], { m: 'ok', x: 'pending' }))
    // 归主后忽略 proxy 自身的 'pending' 登记，以主节点 ok 为准
    expect(locks.isNodeCompleted('x')).toBe(true)
    expect([...locks.lockedNodeIds].sort()).toEqual(['m', 'x'])
  })
})

describe('canConnect：新建连线锁定判定', () => {
  const nodes = [node('s'), node('ok'), node('cap'), node('run'), node('pend')]
  const statusByNode = { ok: 'ok', cap: 'react-capped', run: 'running', pend: 'pending', s: 'pending' }

  it('指向已完成节点被拒（ok / react-capped）', () => {
    const locks = computeRunLocks(input(nodes, [], statusByNode))
    expect(locks.canConnect('pend', 'ok')).toBe(false)
    expect(locks.canConnect('pend', 'cap')).toBe(false)
  })

  it('指向执行中节点被拒；从已完成节点出线被拒', () => {
    const locks = computeRunLocks(input(nodes, [], statusByNode))
    expect(locks.canConnect('pend', 'run')).toBe(false)
    expect(locks.canConnect('ok', 'pend')).toBe(false)
    expect(locks.canConnect('cap', 'pend')).toBe(false)
  })

  it('从执行中节点出线到 pending 允许；两端都 pending 允许', () => {
    const locks = computeRunLocks(input(nodes, [], statusByNode))
    expect(locks.canConnect('run', 'pend')).toBe(true)
    expect(locks.canConnect('pend', 's')).toBe(true)
  })

  it('失败节点作为源与目标都允许（不锁）', () => {
    const locks = computeRunLocks(input([node('f'), node('pend')], [], { f: 'fail', pend: 'pending' }))
    expect(locks.canConnect('f', 'pend')).toBe(true)
    expect(locks.canConnect('pend', 'f')).toBe(true)
  })

  it('不存在的节点按无状态处理：不因缺状态而拒绝', () => {
    // 未知 id 自身无状态；已登记状态的真实节点仍按其状态判定
    const locks = computeRunLocks(input(nodes, [], statusByNode))
    expect(locks.canConnect('nope', 'other')).toBe(true)
    expect(locks.canConnect('ok', 'nope')).toBe(false)
    expect(locks.canConnect('nope', 'run')).toBe(false)
  })

  it('虚拟节点归主后判定：目标 proxy 归主为已完成 → 拒；源 proxy 归主为执行中 → 允许', () => {
    const withProxy = [node('m'), proxy('x', 'm'), node('r'), proxy('y', 'r'), node('pend')]
    const locks = computeRunLocks(input(withProxy, [], { m: 'ok', r: 'running', pend: 'pending' }))
    expect(locks.canConnect('pend', 'x')).toBe(false)
    expect(locks.canConnect('y', 'pend')).toBe(true)
    expect(locks.canConnect('pend', 'y')).toBe(false)
  })

  it('enabled=false：已完成 / 执行中目标也允许（全部解锁）', () => {
    const locks = computeRunLocks(input(nodes, [], statusByNode, false))
    expect(locks.canConnect('pend', 'ok')).toBe(true)
    expect(locks.canConnect('ok', 'run')).toBe(true)
  })
})

describe('未知 id 谓词', () => {
  it('不存在的节点/连线 id：全部返回 false', () => {
    const locks = computeRunLocks(input([node('a')], [], { a: 'ok' }))
    expect(locks.isNodeLocked('nope')).toBe(false)
    expect(locks.isEdgeLocked('nope')).toBe(false)
    expect(locks.isNodeCompleted('nope')).toBe(false)
    expect(locks.isNodeRunning('nope')).toBe(false)
  })
})
