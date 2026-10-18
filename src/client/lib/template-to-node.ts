// src/client/lib/template-to-node.ts
//
// 模板 → 画布节点（深拷贝解耦）：模板字段投影到节点 data。
// 拖入即快照，此后节点与模板无引用关系。

import type { RoleTemplate, TaskTemplate, DatabaseTemplate, GroupTemplate } from '../../host/shared/types.js'

/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
 *  kind 限定 role/task/database；传入 GroupTemplate 时按 None 处理（Team 模板走
 *  placeGroupFromTemplate，不进本函数）。 */
export function templateToNodeData(
  kind: 'role' | 'task' | 'database',
  template: RoleTemplate | TaskTemplate | DatabaseTemplate | GroupTemplate | null | undefined,
): Record<string, unknown> | null {
  if (!template) return null
  const label = String(template.name ?? '').trim() ? String(template.name) : ''
  if (kind === 'role') {
    const role = template as RoleTemplate
    return {
      label,
      systemPrompt: String(role.systemPrompt ?? ''),
      provider: String(role.provider ?? ''),
      model: String(role.model ?? ''),
      reasoning: (role.reasoning as string | null | undefined) ?? null,
      presetId: role.presetId ?? 'standard',
      retryLimit: Number(role.retryLimit ?? 3),
      reactLimit: role.reactLimit ?? null,
      inputSchema: String(role.inputSchema ?? ''),
      outputSchema: String(role.outputSchema ?? ''),
      injectSystemPrompt: role.injectSystemPrompt !== false,
      injectToolSections: role.injectToolSections !== false,
      promptFilePath: String(role.promptFilePath ?? '') || undefined,
      groupId: null,
    }
  }
  if (kind === 'task') {
    const task = template as TaskTemplate
    return {
      label,
      content: String(task.content ?? ''),
    }
  }
  const db = template as DatabaseTemplate
  return {
    label,
    description: String(db.description ?? ''),
    dbType: db.dbType === 'server' ? 'server' : 'local',
    dbKind: db.dbKind ?? 'sqlite',
    localPath: String(db.localPath ?? ''),
    conn: db.conn ? { ...db.conn } : undefined,
    vectorSource: db.vectorSource === 'bm25' ? 'bm25' : 'embedding',
  }
}
