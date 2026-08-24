// src/host/remote/transfer.ts
//
// 导入导出（v2 bundle）：工作流导出 = 自包含 bundle（节点数据已深拷贝内联），
// 组协作 Prompt 与工具组合作为嵌入式资源随包携带；角色模板导出 = 单模板 JSON。
// 导入冲突按「名称」判定：重名返回 conflict（client 选择 rename / overwrite），
// 模板/组合重名复用已有（id 重映射），id 冲突换新 id。

import type { FlowStore } from '../storage/flow-store.js'
import type { BundleV2, GroupTemplate, RoleTemplate, ToolCombo } from '../shared/types.js'
import type { WorkflowDocument } from '../shared/graph-model.js'

function safeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T
}

function httpError(status: number, message: string): Error {
  const error = new Error(message)
  ;(error as Error & { status: number }).status = status
  return error
}

/** 从工作流节点提取协作组模板（协作 Prompt 的独立管理视图）。 */
function groupsOf(flow: WorkflowDocument): GroupTemplate[] {
  return (flow.nodes ?? [])
    .filter((node) => node.kind === 'group')
    .map((node) => ({
      id: node.id,
      name: node.data.label || node.id,
      collabPrompt: String(node.data.collabPrompt ?? ''),
    }))
}

/** 导出工作流为自包含 bundle（格式化 JSON 字符串）。 */
export async function exportWorkflowBundle(store: FlowStore, sessionId: string, flowId: string): Promise<string> {
  const flow = await store.getWorkflow(sessionId, flowId)
  if (!flow) throw httpError(404, `工作流不存在：${flowId}`)
  const combos = await store.listToolCombos().catch(() => [])
  const bundle: BundleV2 = {
    format: 'dsh-vw-bundle',
    version: 2,
    mode: flow.mode,
    workflow: {
      name: flow.name ?? flow.id,
      description: flow.description ?? '',
      nodes: safeClone(flow.nodes ?? []),
      lines: safeClone(flow.lines ?? []),
    },
    embedded: {
      groups: groupsOf(flow),
      combos: safeClone(combos),
    },
  }
  return JSON.stringify(bundle, null, 2)
}

/**
 * 导入工作流 bundle。
 * @param conflictMode rename | overwrite；缺省且重名时返回 { conflict }。
 */
export async function importWorkflowBundle(
  store: FlowStore,
  sessionId: string,
  json: unknown,
  options: { conflictMode?: 'rename' | 'overwrite' } = {},
): Promise<unknown> {
  let bundle: BundleV2
  try {
    bundle = JSON.parse(String(json ?? '')) as BundleV2
  } catch {
    throw httpError(400, '无效的 JSON 文件')
  }
  if (bundle?.format !== 'dsh-vw-bundle' || !bundle.workflow?.name) {
    throw httpError(422, '不是有效的 Visual Workflow 工作流导出文件')
  }
  const existing = (await store.listWorkflows(sessionId)).find((flow) => flow.name === bundle.workflow?.name)
  if (existing && options.conflictMode !== 'rename' && options.conflictMode !== 'overwrite') {
    return { conflict: true, existingName: existing.name, existingId: existing.id }
  }
  const mode = bundle.mode === 'mode2' ? 'mode2' : 'mode1'
  let name = bundle.workflow.name
  if (existing && options.conflictMode === 'rename') {
    name = uniqueName(name, (await store.listWorkflows(sessionId)).map((flow) => flow.name))
  }
  // overwrite 的原子性：新条目落库成功后再删除旧条目
  const overwriteTargetId = existing && options.conflictMode === 'overwrite' ? existing.id : undefined
  const flowId = overwriteTargetId ?? `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  // 组合并入：重名复用已有，否则创建（id 冲突换新 id）
  const combos = bundle.embedded?.combos ?? []
  for (const combo of combos) {
    if (!combo?.id || !String(combo.name ?? '').trim()) continue
    const sameName = (await store.listToolCombos()).find((item) => item.name === combo.name)
    if (sameName) continue
    const exists = (await store.listToolCombos()).some((item) => item.id === combo.id)
    const final: ToolCombo = {
      id: (exists ? `combo-${Math.random().toString(36).slice(2, 8)}` : combo.id) as `combo-${string}`,
      name: combo.name,
      tools: Array.isArray(combo.tools) ? combo.tools.filter((item) => typeof item === 'string') : [],
      mcpServers: Array.isArray(combo.mcpServers) ? combo.mcpServers.filter((item) => typeof item === 'string') : [],
    }
    await store.saveToolCombo(final)
  }

  const flow: WorkflowDocument = {
    id: flowId,
    sessionId,
    mode,
    name,
    description: String(bundle.workflow.description ?? ''),
    revision: 0,
    nodes: safeClone(bundle.workflow.nodes ?? []),
    lines: safeClone(bundle.workflow.lines ?? []),
  }
  const saved = await store.saveWorkflow(flow, sessionId, { force: true })
  if (existing && options.conflictMode === 'overwrite' && existing.id !== saved.id) {
    await store.deleteWorkflow(sessionId, existing.id)
  }
  return { workflow: saved, importedGroups: (bundle.embedded?.groups ?? []).length }
}

/** 导出角色模板为单模板 JSON 字符串。 */
export async function exportAgentTemplate(store: FlowStore, id: string): Promise<string> {
  const template = await store.getTemplate('role', id)
  if (!template) throw httpError(404, `角色模板不存在：${id}`)
  return JSON.stringify({ format: 'dsh-vw-template', version: 2, template: safeClone(template) }, null, 2)
}

/** 导入角色模板（重名冲突语义同工作流导入）。 */
export async function importAgentTemplate(
  store: FlowStore,
  json: unknown,
  options: { conflictMode?: 'rename' | 'overwrite' } = {},
): Promise<unknown> {
  let payload: { format?: unknown; version?: unknown; template?: RoleTemplate }
  try {
    payload = JSON.parse(String(json ?? '')) as typeof payload
  } catch {
    throw httpError(400, '无效的 JSON 文件')
  }
  if (payload?.format !== 'dsh-vw-template' || !payload.template || !payload.template.id) {
    throw httpError(422, '不是有效的角色模板导出文件')
  }
  const template = payload.template
  const existing = (await store.listTemplates('role')).find((item) => item.id !== undefined && (item as { name?: string }).name === template.name)
  if (existing && options.conflictMode !== 'rename' && options.conflictMode !== 'overwrite') {
    return { conflict: true, existingName: (existing as { name?: string }).name, existingId: existing.id }
  }
  let finalId = template.id
  let name = template.name
  if (existing && options.conflictMode === 'overwrite') {
    finalId = existing.id
  } else if (existing && options.conflictMode === 'rename') {
    finalId = `${template.id}-${Math.random().toString(36).slice(2, 8)}`
    name = uniqueName(template.name, (await store.listTemplates('role')).map((item) => String((item as { name?: string }).name ?? '')))
  } else if ((await store.getTemplate('role', template.id))) {
    finalId = `${template.id}-${Math.random().toString(36).slice(2, 8)}`
  }
  const saved = await store.saveTemplate('role', { ...safeClone(template), id: finalId, name })
  return { template: saved }
}

function uniqueName(base: string, existingNames: string[]): string {
  const names = new Set(existingNames.map((name) => String(name)))
  let candidate = String(base)
  let index = 2
  while (names.has(candidate)) {
    candidate = `${base} (${index})`
    index += 1
  }
  return candidate
}
