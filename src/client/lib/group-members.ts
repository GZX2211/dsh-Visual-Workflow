// src/client/lib/group-members.ts
//
// 协作组成员关系（需求 §4.2.5.2）：重复组节点合并、原子入组、成员入组时的流程线清理。
// 全部为纯函数（返回新数组，不改写入参），供左栏模板拖入与画布内节点拖入两条路径共用。
// 入参只要求「id + data」最小形状，画布节点（CanvasNode）与任意同形投影均可直接传入。

/**
 * 合并重复节点（修复历史数据中协作组节点被重复追加的缺陷）：
 *  - 同 id 的协作组节点合并为一个，memberIds 取**并集**（不丢任何成员），其余字段保留后出现者；
 *  - 每个协作组节点的 memberIds **一律去重**（即便单组内出现重复 id，也会被清理）。
 * 非协作组节点同 id 直接保留最后出现者。返回合并后的新数组。
 */
export function consolidateGroups<T extends { id: string; data: Record<string, unknown> }>(nodes: T[]): T[] {
  const result: T[] = []
  const indexBy = new Map<string, number>()
  const forEachNode = (node: T): void => {
    const idx = indexBy.get(node.id)
    if (idx === undefined) {
      indexBy.set(node.id, result.length)
      result.push(node)
      return
    }
    const existing = result[idx] as (T & { kind?: unknown })
    const nodeKind = (node as { kind?: unknown }).kind
    if (existing.kind === 'group' && nodeKind === 'group') {
      const union = [...new Set([
        ...(Array.isArray(existing.data.memberIds) ? existing.data.memberIds as string[] : []),
        ...(Array.isArray(node.data.memberIds) ? node.data.memberIds as string[] : []),
      ])]
      result[idx] = { ...node, data: { ...node.data, memberIds: union } } as T
    } else {
      result[idx] = node
    }
  }
  // 第一遍：合并同 id 组；第二遍：给每个协作组节点去重 memberIds（即便单组）
  const merged = (() => { for (const node of nodes) forEachNode(node); return result })()
  return merged.map((n) => ((n as { kind?: unknown }).kind === 'group'
    ? { ...n, data: { ...n.data, memberIds: [...new Set(Array.isArray(n.data.memberIds) ? n.data.memberIds as string[] : [])] } } as T
    : n))
}

/**
 * 原子入组：一次变更同时设置「成员节点 data.groupId」与「协作组 data.memberIds（追加去重）」。
 * 入组限定角色节点（parent/agent），返回新 nodes 数组；非角色/非组则原样返回。
 * 先把重复的协作组节点合并（并集），再在**唯一**的组上追加，杜绝「删 1 个移出多个 / 只显示一个」的不一致。
 * 供左栏模板拖入与画布内节点拖入两条路径共用。
 */
export function joinNodeToGroup<T extends { id: string; data: Record<string, unknown> }>(nodes: T[], nodeId: string, groupId: string): T[] {
  const base = consolidateGroups(nodes)
  const node = base.find((n) => n.id === nodeId)
  const group = base.find((n) => n.id === groupId)
  const nodeKind = (node as { kind?: unknown } | undefined)?.kind
  const groupKind = (group as { kind?: unknown } | undefined)?.kind
  if (!node || !group || groupKind !== 'group') return base
  if (nodeKind !== 'parent' && nodeKind !== 'agent') return base
  const members = Array.isArray(group.data.memberIds) ? (group.data.memberIds as string[]) : []
  const nextMembers = members.includes(nodeId) ? members : [...members, nodeId]
  return base.map((n) => {
    if (n.id === nodeId) return { ...n, data: { ...n.data, groupId } } as T
    if (n.id === groupId) return { ...n, data: { ...n.data, memberIds: nextMembers } } as T
    return n
  })
}

/**
 * 移除指定节点的流程连线（角色拖入协作组后仅保留上下文/数据库线，§4.2.5.2 规则 4）：
 * 组内成员只有上下文/数据库连接点，无流程接点；已连的流程线在入组时自动断开。
 */
export function dropNodeFlowLines<T extends { source: string; target: string; sourceHandle?: string; targetHandle?: string }>(lines: T[], nodeId: string): T[] {
  return lines.filter((line) => !(
    (line.source === nodeId && (line.sourceHandle ?? '') === 'flow-out')
    || (line.target === nodeId && (line.targetHandle ?? '') === 'flow-in')
  ))
}
