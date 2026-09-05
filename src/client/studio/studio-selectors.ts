// src/client/studio/studio-selectors.ts
//
// 工作台状态机选择器（纯函数，派生数据）：当前工作流/模板/服务文档、
// 运行状态判定与编辑器渲染数据。组件与 hooks 消费；Inspector 按
// editorData 的 kind 分发表单。

import type { StudioState, EditorData } from './studio-types.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'

/** 当前工作流文档（内存列表优先；草稿回退）。 */
export function currentFlowOf(state: StudioState): WorkflowDocument | null {
  if (state.currentKind !== 'workflow' || !state.currentId) return null
  return state.workflows.find((flow) => flow.id === state.currentId) ?? null
}

/** 当前工作流模板文档（模板态画布）。 */
export function currentFlowTemplateOf(state: StudioState): WorkflowTemplate | null {
  if (state.currentKind !== 'flowTemplate' || !state.currentId) return null
  return state.flowTemplates.find((template) => template.id === state.currentId) ?? null
}

/** 当前服务文档。 */
export function currentServiceOf(state: StudioState): ServiceState | null {
  if (state.currentKind !== 'service' || !state.currentId) return null
  return state.services.find((service) => service.id === state.currentId) ?? null
}

/** 当前运行状态（running 判定）。 */
export function isRunningOf(state: StudioState): boolean {
  return state.run.snapshot?.status === 'running' || (state.run.runId !== null && state.run.snapshot === null)
}

/** 编辑器数据（右侧面板渲染源）。 */
export function editorDataOf(state: StudioState): EditorData | null {
  const editor = state.editor
  if (!editor) return null
  if (editor.source === 'workflow') {
    const flow = state.workflows.find((item) => item.id === editor.id)
    return flow
      ? { kind: 'workflow', data: { name: flow.name, description: flow.description }, name: flow.name }
      : null
  }
  if (editor.source === 'flowTemplate') {
    const template = state.flowTemplates.find((item) => item.id === editor.id)
    return template
      ? { kind: 'workflow', data: { name: template.name, description: template.description }, name: template.name, template: true, templateId: template.id }
      : null
  }
  if (editor.source === 'service') {
    const service = state.services.find((item) => item.id === editor.id)
    return service
      ? { kind: 'service', data: { name: service.name, description: service.description }, name: service.name }
      : null
  }
  if (editor.source === 'template') {
    const template = state.templates[editor.kind].find((item) => item.id === editor.id)
    if (!template) return null
    const kind0 = editor.kind
    return {
      kind: kind0,
      data: template as unknown as Record<string, unknown>,
      name: String((template as { name?: unknown }).name ?? ''),
      templateId: template.id,
      template: true,
      isParent: kind0 === 'role' && (template as { kind?: unknown }).kind === 'parent',
    }
  }
  if (editor.source === 'node') {
    const node = state.canvas.nodes.find((item) => item.id === editor.id)
    if (!node) return null
    const data = node.data
    if (node.kind === 'parent' || node.kind === 'agent') {
      return { kind: 'role', data, name: String(data.label ?? ''), nodeId: node.id, isParent: node.kind === 'parent' }
    }
    if (node.kind === 'file') return { kind: 'file', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'database') return { kind: 'database', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'group') {
      // 去重展示（历史数据可能残留重复 memberIds），与删除逻辑保持一致，避免出现「重复成员行/计数虚高」
      const memberIds = [...new Set((data.memberIds as string[] | undefined) ?? [])]
      const members = memberIds.map((memberId) => {
        const member = state.canvas.nodes.find((item) => item.id === memberId)
        return { id: memberId, label: String((member?.data as { label?: unknown } | undefined)?.label ?? memberId) }
      })
      return { kind: 'group', data, name: String(data.label ?? ''), nodeId: node.id, members }
    }
    if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') return { kind: 'stage', data, name: String(data.label ?? ''), nodeId: node.id }
    if (node.kind === 'proxy') {
      const sourceId = String((node as { proxySourceId?: unknown }).proxySourceId ?? '')
      const main = state.canvas.nodes.find((item) => item.id === sourceId)
      return {
        kind: 'proxy',
        data,
        name: '',
        nodeId: node.id,
        mainLabel: String((main?.data as { label?: unknown } | undefined)?.label ?? ''),
      }
    }
    return { kind: 'role', data, name: String(data.label ?? ''), nodeId: node.id }
  }
  if (editor.source === 'edge') {
    const edge = state.canvas.edges.find((item) => item.id === editor.id)
    return edge ? { kind: 'edge', data: edge as unknown as Record<string, unknown>, name: '' } : null
  }
  return null
}

// ---------------------------------------------------------------------------
// 折叠切换循环（6 态）与面板显隐推导
// ---------------------------------------------------------------------------

/** 折叠/切换循环长度（共 6 态）。 */
export const PANEL_CYCLE_LEN = 6
/** 循环位置枚举：0=左栏展开 1=底栏展开 2=底栏收起(全隐) 3=底栏展开 4=左栏展开 5=左栏收起(全隐)。 */
export const PANEL_MODE_LEFT = 0
export const PANEL_MODE_BOTTOM = 1
export const PANEL_MODE_NONE_BOTTOM = 2
export const PANEL_MODE_BOTTOM2 = 3
export const PANEL_MODE_LEFT2 = 4
export const PANEL_MODE_NONE_LEFT = 5

/** 折叠/切换下一步循环位置（左展→切底→底收→底展→切左→左收→左展）。 */
export function nextPanelMode(mode: number): number {
  return (mode + 1) % PANEL_CYCLE_LEN
}

/** 左栏是否展开（循环位置 0 或 4）。 */
export function leftPanelOpenOf(state: StudioState): boolean {
  return state.panels.mode === PANEL_MODE_LEFT || state.panels.mode === PANEL_MODE_LEFT2
}

/** 底栏是否展开（循环位置 1 或 3）。 */
export function bottomPanelOpenOf(state: StudioState): boolean {
  return state.panels.mode === PANEL_MODE_BOTTOM || state.panels.mode === PANEL_MODE_BOTTOM2
}

/** 是否处于「两侧全隐」态（循环位置 2 或 5；仅画布）。 */
export function panelsFullyCollapsedOf(state: StudioState): boolean {
  return state.panels.mode === PANEL_MODE_NONE_BOTTOM || state.panels.mode === PANEL_MODE_NONE_LEFT
}

/**
 * 右侧属性栏是否显示：默认隐藏（折叠），仅当选中「具备属性」的对象时才展开。
 * 判定 = 编辑对象存在且其属性栏类型不是「阶段」（阶段节点/侧栏阶段卡片不具备属性，不弹）；
 * 其余（实例/工作流/服务/模板/角色/文件/数据库/协作组/连线/画布角色节点含父代理节点/虚拟节点）都弹。
 * 注意：父代理模板也具备属性（属性栏显示模板内容），此处一并弹出。
 */
export function inspectorOpenOf(state: StudioState): boolean {
  const data = editorDataOf(state)
  return data != null && data.kind !== 'stage'
}
