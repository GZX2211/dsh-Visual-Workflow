// src/host/scheduler/instantiate.ts
//
// 模板 → 实例（纯函数）：定时任务触发时刻「从模板实例化实例」语义。
// 工作台全局化改版（每会话单实例）：
//   - 目标会话无实例 → instantiateFromTemplate：全新实例（随机 id）；
//   - 目标会话已有实例（当前会话模式覆盖）→ overwriteInstanceFromTemplate：
//     复用既有实例 id/sessionId/createdAt（revision 由保存层递增），
//     名称与内容同步为模板最新定义——「覆盖旧工作流」。
// 节点/连线深拷贝断引用（§4.2.1 语义）；「开启新会话」为一次性临时选项，
// 实例文档不再继承 startNewSession/workspacePath（字段已退役）。

import { randomUUID } from 'node:crypto'
import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js'

/** id 生成器（测试注入固定值；缺省随机 UUID）。 */
export type IdGenerator = () => string

/**
 * 模板 → 全新实例文档（目标会话无既有实例时）：
 *   - nodes/lines 深拷贝（JSON 深拷贝，与模板完全断引用）；
 *   - 实例名 = 模板名，与给定名称清单重名时追加序号「(2)」「(3)」…（与画布
 *     createInstanceFromCanvas 的命名规则一致；覆盖场景无重名问题）；
 *   - 不落盘（由调用方 flowStore.saveWorkflow 持久化）。
 */
export function instantiateFromTemplate(
  template: WorkflowTemplate,
  sessionId: string,
  existingNames: string[],
  options: { id?: IdGenerator; now?: () => number } = {},
): WorkflowDocument {
  const idGen = options.id ?? (() => `wf-${randomUUID().slice(0, 12)}`)
  const now = options.now?.() ?? Date.now()
  let name = String(template.name ?? '未命名工作流')
  const names = new Set(existingNames.map((item) => String(item)))
  let index = 2
  while (names.has(name)) {
    name = `${String(template.name ?? '未命名工作流')} (${index})`
    index += 1
  }
  return {
    id: idGen(),
    sessionId,
    mode: template.mode,
    name,
    description: String(template.description ?? ''),
    revision: 0,
    nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as WorkflowDocument['nodes'],
    lines: JSON.parse(JSON.stringify(template.lines ?? [])) as WorkflowDocument['lines'],
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
}

/**
 * 模板 → 覆盖既有实例（目标会话已有实例时——「每会话单实例」覆盖语义）：
 * 复用既有实例的 id/sessionId/createdAt（运行历史按 flowId 连续可追溯），
 * 名称/描述/节点/连线 = 模板最新定义；revision 保持既有值（保存层 +1）。
 * 不落盘（由调用方 flowStore.saveWorkflow 持久化）。
 */
export function overwriteInstanceFromTemplate(
  template: WorkflowTemplate,
  existing: WorkflowDocument,
  options: { now?: () => number } = {},
): WorkflowDocument {
  const now = options.now?.() ?? Date.now()
  return {
    id: existing.id,
    sessionId: existing.sessionId,
    mode: template.mode,
    name: String(template.name ?? existing.name ?? '未命名工作流'),
    description: String(template.description ?? ''),
    revision: Number(existing.revision ?? 0),
    nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as WorkflowDocument['nodes'],
    lines: JSON.parse(JSON.stringify(template.lines ?? [])) as WorkflowDocument['lines'],
    createdAt: existing.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
}
