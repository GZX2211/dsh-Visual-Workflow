// src/client/lib/graph-handles.ts
//
// 连接点表与阶段节点标签（纯数据 + 纯函数）：节点种类 → 可用入/出连接点，
// 以及阶段节点（启动/结束/暂停）在两种模式下的显示名与模板清单。
// 连接点表是 Host graph/model.ts 的客户端镜像（渲染与本地校验共用）。

import type { NodeKind } from '../../host/shared/graph-model.js'

export type HandleSpec = { inputs: string[]; outputs: string[] }

export const HANDLES: Record<string, HandleSpec> = {
  parent: { inputs: ['db-in', 'ctx-in', 'flow-in'], outputs: ['ctx-out', 'flow-out'] },
  agent: { inputs: ['db-in', 'ctx-in', 'flow-in'], outputs: ['ctx-out', 'flow-out'] },
  proxy: { inputs: ['db-in', 'ctx-in', 'flow-in'], outputs: ['ctx-out', 'flow-out'] },
  file: { inputs: [], outputs: ['ctx-out'] },
  database: { inputs: [], outputs: ['db-out'] },
  // 输入/输出节点仅保留一个流程连接点（用户验收标注：连接点多了，应当只有一个；
  // 外部问题已自动注入输入节点，流式返回不依赖输出节点 ctx 连线）
  start: { inputs: [], outputs: ['flow-out'] },
  end: { inputs: ['flow-in'], outputs: [] },
  pause: { inputs: ['flow-in'], outputs: ['flow-out'] },
  group: { inputs: ['flow-in'], outputs: ['flow-out'] },
}

/** 阶段节点显示名（模式一：启动/结束；模式二：输入/输出，需求 §4.2.5.1）。 */
export function stageLabels(mode: string): { start: string; end: string; pause: string } {
  const isMode2 = mode === 'mode2'
  return { start: isMode2 ? '输入' : '启动', end: isMode2 ? '输出' : '结束', pause: '暂停' }
}

/** 阶段节点固定卡片（模式二没有暂停，需求 §4.2.5.1 规则 1/2）。 */
export function stageTemplateKinds(mode: string): Array<{ kind: NodeKind; label: string }> {
  const labels = stageLabels(mode)
  const out: Array<{ kind: NodeKind; label: string }> = [
    { kind: 'start', label: labels.start },
    { kind: 'end', label: labels.end },
  ]
  if (mode !== 'mode2') out.push({ kind: 'pause', label: labels.pause })
  return out
}

export function defaultOutputHandle(kind: string): string {
  const def = HANDLES[kind] ?? HANDLES.agent
  return def.outputs[def.outputs.length - 1] ?? 'flow-out'
}

export function defaultInputHandle(kind: string): string {
  const def = HANDLES[kind] ?? HANDLES.agent
  return def.inputs[def.inputs.length - 1] ?? 'flow-in'
}
