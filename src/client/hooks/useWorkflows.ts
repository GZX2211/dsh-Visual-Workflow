// src/client/hooks/useWorkflows.ts
//
// 工作流列表：加载 / 新建草稿 / 保存（草稿首存入库，正式带 revision 乐观锁）/
// 删除 / 打开。数据模型对齐后端 WorkflowDocument（nodes/lines 全量内联）。

import { useCallback, useRef } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { Drafted, StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface WorkflowsFace {
  /** 加载工作流列表；返回加载的条目（供「进入工作台自动选中实例」复用）。 */
  loadWorkflows(): Promise<WorkflowDocument[]>
  /** 新建本地草稿（_draft 标记；首次保存时真正入库）。 */
  createWorkflowDraft(name: string): WorkflowDocument
  /** 保存画布（草稿入库 / 正式带 revision 更新）。 */
  saveWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowDocument | null>
  /** 模板 → 实例：深拷贝模板内容创建实例草图（名称与现有实例去重；不落盘，由调用方 saveWorkflow）。 */
  instantiateFromTemplate(template: WorkflowTemplate): WorkflowDocument
  deleteWorkflow(id: string): Promise<void>
  openFlow(flow: WorkflowDocument): void
}

/** 画布 → 文档序列化（节点/连线直接映射；P12 图模型接管完整归一化）。 */
export function serializeWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): WorkflowDocument {
  return {
    ...flow,
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      position: node.position,
      data: node.data,
      // 虚拟节点顶层 proxySourceId 保留（Bug 2）：与画布投影对称，
      // 保存后后端 validateFlow 不再报 proxySourceMissing。
      ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
        ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
        : {}),
    })) as WorkflowDocument['nodes'],
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

/** 工作流列表面（远端失败抛错，由调用方 toast）。 */
export function useWorkflows(
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
  sessionId: string,
): WorkflowsFace {
  const loadWorkflows = useCallback(async (): Promise<WorkflowDocument[]> => {
    // 会话未激活时跳过（后端 requires sessionId 400）
    if (!sessionId) {
      dispatch({ type: 'WORKFLOWS_LOADED', items: [] })
      return []
    }
    const items = await remote.call(EP.EP_LIST_WORKFLOWS, { sessionId })
    const list = Array.isArray(items) ? (items as WorkflowDocument[]) : []
    dispatch({ type: 'WORKFLOWS_LOADED', items: list })
    return list
  }, [dispatch, remote, sessionId])

  const createWorkflowDraft = useCallback((name: string): WorkflowDocument => {
    const now = new Date().toISOString()
    const draft = {
      id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      mode: 'mode1',
      name,
      description: '',
      revision: 0,
      nodes: [],
      lines: [],
      createdAt: now,
      // 草稿标记（前端 UI 状态；后端 putWorkflow 经 stripClientMeta 剥除，绝不落盘）
      _draft: true,
    } as Drafted<WorkflowDocument>
    dispatch({ type: 'WORKFLOW_ADDED', flow: draft })
    return draft
  }, [dispatch, sessionId])

  /** 模板 → 实例：深拷贝模板（节点/连线全量内联，与模板完全断引用——§4.2.1 解耦语义）。 */
  const instantiateFromTemplate = useCallback((template: WorkflowTemplate): WorkflowDocument => {
    const now = new Date().toISOString()
    const draft = {
      id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      mode: template.mode,
      name: template.name ?? '未命名工作流',
      description: template.description ?? '',
      revision: 0,
      nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as WorkflowDocument['nodes'],
      lines: JSON.parse(JSON.stringify(template.lines ?? [])) as WorkflowDocument['lines'],
      createdAt: now,
      _draft: true,
    } as Drafted<WorkflowDocument>
    dispatch({ type: 'WORKFLOW_ADDED', flow: draft })
    return draft
  }, [dispatch, sessionId])

  /** 在途保存 Promise（快速双击/重复触发时共享同一请求，避免第二次携带旧 revision 触发 409）。 */
  const saveInflight = useRef<{ flowId: string; promise: Promise<WorkflowDocument | null> } | null>(null)

  const saveWorkflow = useCallback(async (
    flow: WorkflowDocument,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
  ): Promise<WorkflowDocument | null> => {
    // 并发去重：上一次保存尚未返回时，重复调用直接复用同一在途请求。去重必须
    // 按 flowId 区分——否则切换工作流后保存时会复用前一工作流的 Promise，
    // 新工作流内容根本没被持久化（「保存成功」但实际没保存，Bug 清单 P1）。
    if (saveInflight.current?.flowId === flow.id) return saveInflight.current.promise
    const task = (async (): Promise<WorkflowDocument | null> => {
      const serialized = serializeWorkflow(flow, nodes, edges)
      // 保存统一走 putWorkflow：后端在文档不存在时视为创建（revision 0 → 1），
      // id 保持不变——草稿首存不再另 assign id，避免 WORKFLOW_UPDATED 无法命中
      // 列表项、当前画布继续引用旧草稿 id（旧实现每次保存都新建一个副本，
      // 用户感知「保存成功但实际没保存」）。
      const saved = await remote.call(EP.EP_PUT_WORKFLOW, {
        sessionId,
        flow: serialized,
      }) as WorkflowDocument
      dispatch({ type: 'WORKFLOW_UPDATED', flow: saved })
      return saved
    })()
    const entry = { flowId: flow.id, promise: task }
    saveInflight.current = entry
    try {
      return await task
    } finally {
      // 仅当仍是自己的在途条目时清空（期间切到别的工作流保存时不得覆盖其条目）
      if (saveInflight.current === entry) saveInflight.current = null
    }
  }, [dispatch, remote, sessionId])

  const deleteWorkflow = useCallback(async (id: string) => {
    await remote.call(EP.EP_DELETE_WORKFLOW, { sessionId, id })
    dispatch({ type: 'WORKFLOW_REMOVED', id })
  }, [dispatch, remote, sessionId])

  const openFlow = useCallback((flow: WorkflowDocument) => {
    dispatch({ type: 'OPEN_FLOW', flow })
  }, [dispatch])

  return {
    loadWorkflows,
    createWorkflowDraft,
    instantiateFromTemplate,
    saveWorkflow,
    deleteWorkflow,
    openFlow,
  }
}
