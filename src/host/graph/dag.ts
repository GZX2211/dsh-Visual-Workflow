// src/host/graph/dag.ts
//
// 流程子图（仅 flow-out → flow-in 边）的图论纯函数：
//   - buildFlowDag：构建邻接/入度结构（忽略 ctx/db 边与非法端点）；
//   - detectCycleNodes：自实现 DFS 三色染色，返回参与环的节点集合（不抛错、不递归爆栈）；
//   - computeFlowLayers：最长路径分层（环上节点被排除，保证终止）；
//   - maxLayerWidth：单层最大宽度（元参数「并行分支数」判定口径）。
// 独立成文件的原因：检查器（flowCycle / unreachableFromStart / milestoneProxyInvalid /
// 并行分支）与 P1 写图工具都要用；客户端布局另有一份（列优先分层 + 交叉最小化），
// 两者目标不同不共用——此处是 **host 侧判定口径**的唯一实现。
// 纯函数：不读时钟/随机源，不改写入参，节点顺序稳定（同输入同输出）。

import type { GraphNode, Line } from '../shared/graph-model.js'

/** 流程子图（仅包含画布内合法端点的 flow 线）。 */
export interface FlowDag {
  /** 节点 id 列表（保持输入顺序）。 */
  nodeIds: string[]
  /** 邻接表：source → targets（保持线顺序、去重）。 */
  adjacency: Map<string, string[]>
  /** 入边表：target → sources（保持线顺序、去重）。 */
  incoming: Map<string, string[]>
  /** 合法的 flow 线（端点在画布内）。 */
  edges: Array<{ id: string; source: string; target: string }>
}

/**
 * 是否为流程线（flow-out → flow-in）。
 *
 * 为什么必须是**双向匹配**而不是「或」：连接点分 flow / ctx / db 三通道且互斥，
 * 一条线的源点与目标点必须同通道成对。只看单侧（`flow-out` 或 `flow-in`）会把
 * `ctx-out → flow-in` 这类非法/历史手持线判成流程线，使「参与流程」的判定与实际
 * 流程子图（本文件构建的 DAG）口径分裂。本函数是 host 侧**流程线判定的唯一本体**。
 */
export function isFlowLine(line: Line): boolean {
  return line?.sourceHandle === 'flow-out' && line?.targetHandle === 'flow-in'
}

/** 构建流程子图（忽略端点缺失的线，避免悬空引用影响判定）。 */
export function buildFlowDag(nodes: GraphNode[] | null | undefined, lines: Line[] | null | undefined): FlowDag {
  const nodeIds = (nodes ?? []).map((node) => node.id)
  const known = new Set(nodeIds)
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]))
  const incoming = new Map<string, string[]>(nodeIds.map((id) => [id, []]))
  const edges: Array<{ id: string; source: string; target: string }> = []
  for (const line of lines ?? []) {
    if (!isFlowLine(line)) continue
    if (!known.has(line.source) || !known.has(line.target)) continue
    edges.push({ id: line.id, source: line.source, target: line.target })
    const out = adjacency.get(line.source) as string[]
    if (!out.includes(line.target)) out.push(line.target)
    const inc = incoming.get(line.target) as string[]
    if (!inc.includes(line.source)) inc.push(line.source)
  }
  return { nodeIds, adjacency, incoming, edges }
}

/**
 * 环检测（DFS 三色染色）：返回**参与环**的节点集合。
 * 为什么不用拓扑排序的「处理不完」近似：那条路会把「环下游的整段链条」也划入，
 * 判定过宽；三色染色能精确定位环上的节点（灰色回边命中）。
 */
export function detectCycleNodes(dag: FlowDag): Set<string> {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(dag.nodeIds.map((id) => [id, WHITE]))
  const inCycle = new Set<string>()
  /** 显式栈避免深图递归爆栈：帧 = { id, 下一个待访问邻接下标 }。 */
  for (const start of dag.nodeIds) {
    if (color.get(start) !== WHITE) continue
    const stack: Array<{ id: string; index: number }> = [{ id: start, index: 0 }]
    color.set(start, GRAY)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const neighbours = dag.adjacency.get(frame.id) ?? []
      if (frame.index >= neighbours.length) {
        color.set(frame.id, BLACK)
        stack.pop()
        continue
      }
      const next = neighbours[frame.index]
      frame.index += 1
      const state = color.get(next)
      if (state === GRAY) {
        // 回边：命中环。把栈中从 next 到当前帧的节点全部标记（含自身环）。
        let marking = false
        for (const item of stack) {
          if (item.id === next) marking = true
          if (marking) inCycle.add(item.id)
        }
        inCycle.add(next)
        continue
      }
      if (state === WHITE) {
        color.set(next, GRAY)
        stack.push({ id: next, index: 0 })
      }
    }
  }
  return inCycle
}

/**
 * 最长路径分层（列号从 0 起）：仅对**无环视图**计算——环上节点及其下游被排除在
 * 分层之外（返回的 layers 中不含它们），保证算法终止且结果确定。
 * 节点自身层级 = max(所有入边源层级 + 1)，无入边为 0。
 */
export function computeFlowLayers(dag: FlowDag, excluded: Set<string> = new Set()): Map<string, number> {
  const layers = new Map<string, number>()
  const indegree = new Map<string, number>()
  const allowed = new Set(dag.nodeIds.filter((id) => !excluded.has(id)))
  for (const id of allowed) {
    const sources = (dag.incoming.get(id) ?? []).filter((source) => allowed.has(source))
    indegree.set(id, sources.length)
  }
  const queue = [...allowed].filter((id) => (indegree.get(id) ?? 0) === 0)
  for (const id of queue) layers.set(id, 0)
  let cursor = 0
  while (cursor < queue.length) {
    const id = queue[cursor]
    cursor += 1
    for (const next of dag.adjacency.get(id) ?? []) {
      if (!allowed.has(next)) continue
      layers.set(next, Math.max(layers.get(next) ?? 0, (layers.get(id) ?? 0) + 1))
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return layers
}

/** 单层最大宽度（按可执行单元计数；excluded 之外的节点不参与）。 */
export function maxLayerWidth(layers: Map<string, number>, unitIds: Iterable<string>): number {
  const counts = new Map<number, number>()
  for (const id of unitIds) {
    const layer = layers.get(id)
    if (layer === undefined) continue
    counts.set(layer, (counts.get(layer) ?? 0) + 1)
  }
  let max = 0
  for (const count of counts.values()) max = Math.max(max, count)
  return max
}
