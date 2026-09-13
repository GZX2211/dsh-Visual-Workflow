// src/client/lib/layering.ts
//
// 有向图分层与环检测（客户端布局用纯函数；自主编排方案 §7.2 步骤 ②③④）。
// 为什么自研而不引 dagre/elkjs（D-14）：布局是本插件的核心视图能力，第三方库会带来
// 打包体积与「不可控的默认行为」；分层 + 层内排序（layout-order.ts）足以满足
// 「列 = 执行顺序，行 = 层内并行」的方向约定。
//
// 与 host 侧 graph/dag.ts 的关系：host 侧只做「流程子图」判定（检查器用），
// 本模块面向**任意折叠后的有向图**（proxy 归并、协作组折叠后），输入是显式边表。
// 纯函数：不读时钟/随机源，不改写入参，节点顺序稳定（同输入同输出）。

/** 有向边（仅 id 与两端；几何/通道不参与分层）。 */
export interface DirectedEdge {
  source: string
  target: string
}

/** 分层结果。 */
export interface Layering {
  /** 参与分层的节点 id（保持输入顺序，不包括被环排除的节点）。 */
  ids: string[]
  /** 节点 → 层号（从 0 起，保证每条非回流边 col(u) < col(v)）。 */
  layerOf: Map<string, number>
  /** 被识别为「回流边」的边下标集合（分层时忽略，供 UI 标注）。 */
  reversedEdgeIndexes: number[]
}

/**
 * 检测有向图中的环（DFS 三色染色，显式栈避免深图递归爆栈），返回参与环的节点集合。
 * 与 host 侧 graph/dag.ts 同算法但输入形态不同（显式边表）——两侧判定必须一致，
 * 单测各自锁定（此处不跨 program import，避免双 program 类型域污染）。
 */
export function detectCycleNodes(ids: string[], edges: DirectedEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue
    ;(adjacency.get(edge.source) as string[]).push(edge.target)
  }
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(ids.map((id) => [id, WHITE]))
  const inCycle = new Set<string>()
  for (const start of ids) {
    if (color.get(start) !== WHITE) continue
    const stack: Array<{ id: string; index: number }> = [{ id: start, index: 0 }]
    color.set(start, GRAY)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const neighbours = adjacency.get(frame.id) ?? []
      if (frame.index >= neighbours.length) {
        color.set(frame.id, BLACK)
        stack.pop()
        continue
      }
      const next = neighbours[frame.index]
      frame.index += 1
      const state = color.get(next)
      if (state === GRAY) {
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
 * 分层：环上节点先被排除（其所在边全部视为回流边），其余节点按**最长路径**分层
 * （col(u) = max(col(v) + 1)，无入边为 0）。
 * 为什么排除环而不是硬解环：环意味着流程不可终止，检查器会报 flowCycle；
 * 布局只需「不崩、不产生 NaN、不丢节点」——环上节点由调用方放到兜底列。
 */
export function layerGraph(ids: string[], edges: DirectedEdge[]): Layering {
  const cyclic = detectCycleNodes(ids, edges)
  const allowedEdges: DirectedEdge[] = []
  const reversedEdgeIndexes: number[] = []
  edges.forEach((edge, index) => {
    const usable = ids.includes(edge.source) && ids.includes(edge.target)
    const onCycle = cyclic.has(edge.source) || cyclic.has(edge.target)
    if (!usable || onCycle) {
      reversedEdgeIndexes.push(index)
      return
    }
    allowedEdges.push(edge)
  })

  const allowedIds = ids.filter((id) => !cyclic.has(id))
  const adjacency = new Map<string, string[]>(allowedIds.map((id) => [id, []]))
  const indegree = new Map<string, number>(allowedIds.map((id) => [id, 0]))
  for (const edge of allowedEdges) {
    ;(adjacency.get(edge.source) as string[]).push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const layerOf = new Map<string, number>()
  const queue = allowedIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  for (const id of queue) layerOf.set(id, 0)
  let cursor = 0
  while (cursor < queue.length) {
    const id = queue[cursor]
    cursor += 1
    for (const next of adjacency.get(id) ?? []) {
      layerOf.set(next, Math.max(layerOf.get(next) ?? 0, (layerOf.get(id) ?? 0) + 1))
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  // 兜底：理论上所有 allowedIds 都会被访问（DAG）；防御性补齐，避免丢节点
  for (const id of allowedIds) {
    if (!layerOf.has(id)) layerOf.set(id, 0)
  }
  return { ids: allowedIds, layerOf, reversedEdgeIndexes }
}
