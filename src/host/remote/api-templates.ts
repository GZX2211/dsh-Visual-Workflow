// src/host/remote/api-templates.ts
//
// GUI API 模板与文件端点（VisualWorkflowApiTemplates extends Workflows）：
// 角色/文件/数据库模板 CRUD、工作流模板（全局共享）与受管文件上传。
// 方法体逐字移动。

import { httpError } from './http.js'
import { copyIntoManagedFile } from './download.js'
import { stripClientMeta } from './api-base.js'
import { VisualWorkflowApiWorkflows } from './api-workflows.js'

export class VisualWorkflowApiTemplates extends VisualWorkflowApiWorkflows {
  // ---------- 模板（角色/文件/数据库） ----------

  async listTemplates(args: { kind?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database' && kind !== 'group') {
      throw httpError(400, 'requires kind: role|file|database|group')
    }
    return this.host.store.listTemplates(kind as 'role' | 'file' | 'database' | 'group')
  }

  async putTemplate(args: { kind?: unknown; template?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database' && kind !== 'group') {
      throw httpError(400, 'requires kind: role|file|database|group')
    }
    const template = args?.template as Record<string, unknown> | null | undefined
    if (!template || !String(template.id ?? '').trim()) throw httpError(400, 'requires a template id')
    if (kind === 'role' && !String(template.kind ?? '').trim()) {
      template.kind = 'agent'
    }
    // 剥除前端快照标记（_draft 等），防止已入库模板刷新后被误判为草稿
    return this.host.store.saveTemplate(kind as 'role' | 'file' | 'database' | 'group', stripClientMeta(template) as never)
  }

  /** 删除预览：模板与画布节点深拷贝解耦，删除模板不影响任何已有节点。 */
  async deleteTemplatePreview(args: { kind?: unknown; id?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database' && kind !== 'group') {
      throw httpError(400, 'requires kind: role|file|database|group')
    }
    if (!String(args?.id ?? '').trim()) throw httpError(400, 'requires a template id')
    return { affectedNodes: 0, detached: true }
  }

  async deleteTemplate(args: { kind?: unknown; id?: unknown }): Promise<unknown> {
    const kind = String(args?.kind ?? '')
    const id = String(args?.id ?? '')
    if (kind !== 'role' && kind !== 'file' && kind !== 'database' && kind !== 'group') {
      throw httpError(400, 'requires kind: role|file|database|group')
    }
    if (!id) throw httpError(400, 'requires a template id')
    const deleted = await this.host.store.deleteTemplate(kind as 'role' | 'file' | 'database' | 'group', id)
    if (!deleted) throw httpError(404, `模板不存在：${id}`)
    return { deleted: true }
  }

  // ---------- 工作流模板（flow-templates/，全局共享；图2 交互改造） ----------

  /** 工作流模板列表（全部返回，客户端按 mode 过滤；模板跨会话共享不隔离）。 */
  async listFlowTemplates(): Promise<unknown> {
    return this.host.store.listFlowTemplates()
  }

  /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护）。 */
  async putFlowTemplate(args: { template?: unknown }): Promise<unknown> {
    const raw = args?.template as Record<string, unknown> | null | undefined
    if (!raw || !String(raw.id ?? '').trim()) throw httpError(400, 'requires a flow template id')
    const expected = Number(raw.revision)
    if (!Number.isFinite(expected)) throw httpError(400, 'requires a numeric revision')
    try {
      return await this.host.store.saveFlowTemplate(stripClientMeta(raw) as never, { expectedRevision: expected })
    } catch (error) {
      const code = (error as { code?: string })?.code ?? ''
      if (code === 'FLOW_REVISION_CONFLICT') throw httpError(409, String((error as Error).message), code)
      throw error
    }
  }

  /** 删除工作流模板（仅删模板文件，不影响已生成的实例）。 */
  async deleteFlowTemplate(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires a flow template id')
    const deleted = await this.host.store.deleteFlowTemplate(id)
    if (!deleted) throw httpError(404, `工作流模板不存在：${id}`)
    return { deleted: true }
  }
  /** 受管文件上传：base64 内容 → data/files/<safeName>（原子发布；返回 managedPath）。 */
  async fileUpload(args: { name?: unknown; base64?: unknown }): Promise<unknown> {
    const name = String(args?.name ?? '').trim()
    const base64 = String(args?.base64 ?? '')
    if (!name || !base64) throw httpError(400, 'requires name and base64')
    return copyIntoManagedFile(this.host.dataDir, { name, base64 })
  }
}