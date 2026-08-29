// src/host/remote/api-ecosystem.ts
//
// GUI API 生态枚举端点（VisualWorkflowApiEcosystem extends Templates）：
// agent preset 模式 / 全局可见工具 / 可选模型（含思考强度档位）。方法体逐字移动。

import { RESERVED_TRANSPORT_TOOL } from '../shared/protocol.js'
import { httpError } from './http.js'
import { VisualWorkflowApiTemplates } from './api-templates.js'

export class VisualWorkflowApiEcosystem extends VisualWorkflowApiTemplates {
  // ---------- 生态枚举（presets / tools / models） ----------

  /** agent preset 模式列表（agentPresets 服务缺失时返回空列表）。 */
  async presets(): Promise<unknown> {
    const agentPresets = this.ctx.get('agentPresets') as { list?: () => Promise<unknown[]> } | null | undefined
    if (!agentPresets || typeof agentPresets.list !== 'function') return []
    try {
      const items = (await agentPresets.list()) ?? []
      return items
        .filter((item) => (item as { broken?: unknown }).broken !== true)
        .map((item) => {
          const entry = item as { id?: unknown; name?: unknown; metadata?: { name?: unknown; description?: unknown }; description?: unknown; trust?: unknown }
          return {
            id: entry.id,
            name: entry.name ?? entry.metadata?.name ?? entry.id,
            description: entry.description ?? entry.metadata?.description ?? '',
            trust: entry.trust ?? 'user',
          }
        })
    } catch (error) {
      throw new Error(`preset 列表读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 全局层可见工具清单（供组合勾选）。 */
  async tools(): Promise<unknown> {
    const tools = this.ctx.get('tools') as { schemas?: (scope?: unknown) => unknown } | null | undefined
    if (!tools || typeof tools.schemas !== 'function') return []
    try {
      const schemas = (tools.schemas() ?? []) as unknown[]
      return (Array.isArray(schemas) ? schemas : [])
        .map((schema) => {
          const entry = schema as { name?: unknown; title?: unknown; description?: unknown }
          return { name: entry.name ?? entry.title ?? '', description: entry.description ?? '' }
        })
        .filter((item) => item.name && item.name !== RESERVED_TRANSPORT_TOOL)
    } catch (error) {
      throw new Error(`工具清单读取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 可选模型列表（llm 服务缺失返回空列表；单 provider 失败跳过）。 */
  async models(): Promise<unknown> {
    const llm = this.ctx.get('llm') as
      | { listProviders?: () => unknown[]; listModels?: (provider: string) => Promise<unknown[]> }
      | null
      | undefined
    if (!llm || typeof llm.listProviders !== 'function') return []
    const out: Array<{ provider: string; model: string }> = []
    let providers: unknown[] = []
    try {
      providers = llm.listProviders() ?? []
    } catch {
      providers = []
    }
    for (const entry of providers) {
      const name = typeof entry === 'string' ? entry : (entry as { id?: unknown; name?: unknown })?.id ?? (entry as { name?: unknown })?.name
      if (!name) continue
      try {
        if (typeof llm.listModels !== 'function') continue
        const models = (await llm.listModels(String(name))) ?? []
        for (const model of models ?? []) {
          const info = typeof model === 'string' ? null : model as { id?: unknown; name?: unknown; efforts?: Array<{ id?: unknown; name?: unknown }> }
          const id = typeof model === 'string' ? model : info?.id ?? info?.name
          if (id) {
            // 思考强度列表：适配器公布的 reasoning efforts（V-02）；未公开时 undefined（client 回退内置档位）
            const efforts = Array.isArray(info?.efforts)
              ? info.efforts
                  .map((effort) => ({ id: String(effort.id ?? ''), name: String(effort.name ?? effort.id ?? '') }))
                  .filter((effort) => effort.id)
              : undefined
            out.push({ provider: String(name), model: String(id), ...(efforts ? { efforts } : {}) })
          }
        }
      } catch {
        // 单 provider 失败跳过
      }
    }
    return out
  }

}