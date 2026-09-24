// src/client/lib/connection-rules.ts
//
// 连接校验（与 Host graph/validate 规则一致；返回 { valid, code, branch? }）：
// 在画布上建立一条连线（sourceHandle → targetHandle）前的本地校验与文案投影。

import type { CanvasEdge, CanvasNode } from './canvas-model.js'
import { nodeKindOf } from './canvas-model.js'
import { HANDLES, defaultInputHandle, defaultOutputHandle } from './graph-handles.js'

export interface ConnectionProblem {
  valid: boolean
  code: string
  branch?: string
}

/** 连接校验：在画布上建立一条连线（sourceHandle → targetHandle）。 */
export function connectionProblem(nodes: CanvasNode[], lines: CanvasEdge[], connection: { source: string; target: string; sourceHandle?: string; targetHandle?: string; lineId?: string }): ConnectionProblem {
  if (!connection?.source || !connection?.target) return { valid: false, code: 'invalidConnection' }
  if (connection.source === connection.target) return { valid: false, code: 'selfLoop' }
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target) return { valid: false, code: 'invalidConnection' }
  const sourceKind = nodeKindOf(source)
  const targetKind = nodeKindOf(target)
  const sourceHandle = connection.sourceHandle ?? defaultOutputHandle(sourceKind)
  const targetHandle = connection.targetHandle ?? defaultInputHandle(targetKind)
  const sourceDef = HANDLES[sourceKind] ?? HANDLES.agent
  const targetDef = HANDLES[targetKind] ?? HANDLES.agent
  if (!sourceDef.outputs.includes(sourceHandle)) return { valid: false, code: 'invalidHandle' }
  if (!targetDef.inputs.includes(targetHandle)) return { valid: false, code: 'invalidHandle' }
  const channel = sourceHandle.replace(/-out$/, '')
  if (targetHandle !== `${channel}-in`) return { valid: false, code: 'channelMismatch' }
  // 协作组成员不能连流程线（§4.2.5.2 规则 4）：角色在组内时仅 ctx/db 连接点
  const memberSource = (sourceKind === 'parent' || sourceKind === 'agent') && Boolean((source as { data?: { groupId?: unknown } }).data?.groupId)
  const memberTarget = (targetKind === 'parent' || targetKind === 'agent') && Boolean((target as { data?: { groupId?: unknown } }).data?.groupId)
  if (channel === 'flow' && (memberSource || memberTarget)) return { valid: false, code: 'groupMemberFlow' }
  if (targetKind === 'start') return { valid: false, code: 'startInput' }
  if (sourceKind === 'end') return { valid: false, code: 'endOutput' }
  // 虚拟节点与主节点：同一目标节点的同一连接点不得同时连入（防重复触发，§4.2.3.2 规则 6）
  const relatedOf = (node: CanvasNode): CanvasNode[] => {
    if (node.kind === 'proxy') {
      return nodes.filter((item) => item.id === node.proxySourceId || (item.kind === 'proxy' && item.proxySourceId === node.proxySourceId))
    }
    if (node.kind === 'parent' || node.kind === 'agent') {
      return nodes.filter((item) => item.kind === 'proxy' && item.proxySourceId === node.id)
    }
    return []
  }
  for (const node of [source, target]) {
    for (const other of relatedOf(node)) {
      const blocked = lines.some((line) =>
        (line.source === other.id && line.target === target.id && (line.sourceHandle ?? '') === sourceHandle && (line.targetHandle ?? '') === targetHandle)
        || (line.source === source.id && line.target === other.id && (line.sourceHandle ?? '') === sourceHandle && (line.targetHandle ?? '') === targetHandle)
      )
      if (blocked) return { valid: false, code: 'proxyParallel' }
    }
  }
  if (lines.some((line) =>
    line.source === connection.source && line.target === connection.target
    && (line.sourceHandle ?? '') === sourceHandle
    && (line.targetHandle ?? '') === targetHandle
    && line.id !== connection.lineId
  )) return { valid: false, code: 'duplicateConnection' }
  return { valid: true, code: 'ok', branch: sourceHandle }
}

export function connectionProblemMessage(problem: ConnectionProblem, copy: Record<string, string>): string {
  if (!problem || problem.valid) return ''
  const messages: Record<string, string> = {
    selfLoop: copy.selfLoop,
    duplicateConnection: copy.duplicateConnection,
    proxyParallel: copy.proxyParallel ?? copy.invalidConnection,
    channelMismatch: copy.invalidConnection,
    groupMemberFlow: copy.groupMemberFlowLine ?? copy.invalidConnection,
    startInput: copy.invalidConnection,
    endOutput: copy.invalidConnection,
    invalidHandle: copy.invalidConnection,
    invalidConnection: copy.invalidConnection,
  }
  return messages[problem.code] ?? copy.invalidConnection
}
