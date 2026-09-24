// src/client/lib/template-to-node.ts
//
// 模板 → 画布节点（深拷贝解耦，需求 §4.2.1）：模板映射与字段投影。
// 拖入即快照，此后节点与模板无引用关系。

import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../host/shared/types.js'

export type TemplateKind = 'role' | 'file' | 'database'
export type TemplateMap = Map<string, RoleTemplate | FileTemplate | DatabaseTemplate>

/** 模板映射：{ role: Map, file: Map, database: Map }（id → 模板）。 */
export function templatesToMaps(
  roleTemplates: RoleTemplate[] | null | undefined,
  fileTemplates: FileTemplate[] | null | undefined,
  databaseTemplates: DatabaseTemplate[] | null | undefined,
): Record<TemplateKind, TemplateMap> {
  return {
    role: new Map((roleTemplates ?? []).map((template) => [template.id, template])),
    file: new Map((fileTemplates ?? []).map((template) => [template.id, template])),
    database: new Map((databaseTemplates ?? []).map((template) => [template.id, template])),
  }
}

/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
 *  kind 限定 role/file/database；传入 GroupTemplate 时按 None 处理（协作组模板走
 *  placeGroupFromTemplate，不进本函数）。 */
export function templateToNodeData(
  kind: 'role' | 'file' | 'database',
  template: RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate | null | undefined,
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
  if (kind === 'file') {
    const file = template as FileTemplate
    const managedPath = String(file.managedPath ?? '')
    // files 列表（多选）优先；兼容单选旧字段（fileName/managedPath）——
    // 拖入画布的数据形状以本函数为唯一实现（后端曾有的同名映射已随 storage 模块治理
    // 删除：模板→节点映射属客户端画布职责），不丢失多选文件路径（需求 §4.2.4.1）。
    const files = Array.isArray(file.files) && file.files.length > 0
      ? file.files.map((item) => ({ fileName: String(item?.fileName ?? ''), managedPath: String(item?.managedPath ?? '') }))
      : []
    return {
      label,
      fileKind: file.fileKind === 'file' ? 'file' : 'text',
      content: String(file.content ?? ''),
      managedPath: managedPath || undefined,
      fileName: String(managedPath ? managedPath.split(/[\\/]/).pop() : ''),
      ...(files.length > 0 ? { files } : {}),
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

/** 画布节点 kind → 模板 kind（parent/agent → role；proxy/stage/group 无模板）。 */
export function templateKindOfNode(nodeKind: string): TemplateKind | null {
  if (nodeKind === 'parent' || nodeKind === 'agent') return 'role'
  if (nodeKind === 'file') return 'file'
  if (nodeKind === 'database') return 'database'
  return null
}
