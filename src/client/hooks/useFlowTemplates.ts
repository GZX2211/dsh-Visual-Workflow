// src/client/hooks/useFlowTemplates.ts
//
// 工作流模板列表（图2 交互改造新增）：加载 / 新建草稿 / 保存 / 删除 / 打开。
// 模板实体与工作流实例同构（nodes/lines 全量内联），但**全局共享、跨会话可见**，
// 拖入画布保存后经「创建实例」转为当前会话的实例（useWorkflows.saveWorkflow）。
// 数据模型对齐后端 WorkflowTemplate（shared/graph-model.ts）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { Drafted, StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface FlowTemplatesFace {
  loadFlowTemplates(): Promise<void>
  /** 新建本地模板草稿（_draft 标记；首次保存时真正入库）。 */
  createFlowTemplateDraft(mode: 'mode1' | 'mode2'): WorkflowTemplate
  /** 保存模板（画布节点/连线序列化后入库；草稿首存保持 id）。 */
  saveFlowTemplate(template: WorkflowTemplate, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowTemplate | null>
  deleteFlowTemplate(id: string): Promise<void>
  openFlowTemplate(template: WorkflowTemplate): void
}

/** 画布 → 模板序列化（与 serializeWorkflow 同构）。 */
export function serializeFlowTemplate(template: WorkflowTemplate, nodes: CanvasNode[], edges: CanvasEdge[]): WorkflowTemplate {
  return {
    ...template,
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position,
      data: node.data,
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    })) as WorkflowTemplate['nodes'],
    lines: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      ...(edge.condition ? { condition: edge.condition } : {}),
    })),
  }
}

/** 工作流模板列表面（远端失败抛错，由调用方 toast）。 */
export function useFlowTemplates(dispatch: Dispatch<StudioAction>, remote: RemoteFace): FlowTemplatesFace {
  const loadFlowTemplates = useCallback(async () => {
    const items = await remote.call(EP.EP_LIST_FLOW_TEMPLATES)
    dispatch({ type: 'FLOW_TEMPLATES_LOADED', items: Array.isArray(items) ? (items as WorkflowTemplate[]) : [] })
  }, [dispatch, remote])

  const createFlowTemplateDraft = useCallback((mode: 'mode1' | 'mode2'): WorkflowTemplate => {
    const now = new Date().toISOString()
    const draft = {
      id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      mode,
      name: mode === 'mode1' ? '未命名工作流模板' : '未命名服务模板',
      description: '',
      revision: 0,
      nodes: [],
      lines: [],
      createdAt: now,
      // 草稿标记（前端 UI 状态；后端 putFlowTemplate 经 stripClientMeta 剥除，绝不落盘）
      _draft: true,
    } as Drafted<WorkflowTemplate>
    dispatch({ type: 'FLOW_TEMPLATE_ADDED', template: draft })
    return draft
  }, [dispatch])

  const saveFlowTemplate = useCallback(async (
    template: WorkflowTemplate,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
  ): Promise<WorkflowTemplate | null> => {
    const serialized = serializeFlowTemplate(template, nodes, edges)
    const saved = await remote.call(EP.EP_PUT_FLOW_TEMPLATE, {
      template: serialized,
    }) as WorkflowTemplate
    dispatch({ type: 'FLOW_TEMPLATE_UPDATED', template: saved })
    return saved
  }, [dispatch, remote])

  const deleteFlowTemplate = useCallback(async (id: string) => {
    await remote.call(EP.EP_DELETE_FLOW_TEMPLATE, { id })
    dispatch({ type: 'FLOW_TEMPLATE_REMOVED', id })
  }, [dispatch, remote])

  const openFlowTemplate = useCallback((template: WorkflowTemplate) => {
    dispatch({ type: 'OPEN_FLOW_TEMPLATE', template })
  }, [dispatch])

  return { loadFlowTemplates, createFlowTemplateDraft, saveFlowTemplate, deleteFlowTemplate, openFlowTemplate }
}
