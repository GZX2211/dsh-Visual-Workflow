// src/host/scheduler/instantiate.ts
//
// 模板 → 实例（纯函数 + 名称去重）：触发时刻与「模板态点击运行」语义一致
// （用户裁决：自动创建实例并自动运行，逻辑与画布直接复用）。
// 实例 id/名称由调用方注入生成器（测试可控）；节点/连线深拷贝断引用（§4.2.1 语义）。

import { randomUUID } from 'node:crypto'
import type { WorkflowDocument, WorkflowTemplate } from '../shared/graph-model.js'

/** id 生成器（测试注入固定值；缺省随机 UUID）。 */
export type IdGenerator = () => string

/**
 * 模板 → 实例文档：
 *   - nodes/lines 深拷贝（JSON 深拷贝，与模板完全断引用）；
 *   - 实例名 = 模板名，与给定名称清单重名时追加序号「(2)」「(3)」…（与画布
 *     createInstanceFromCanvas 的命名规则一致）；
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
