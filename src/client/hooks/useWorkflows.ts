// src/client/hooks/useWorkflows.ts
//
// 工作流列表：加载 / 新建草稿 / 保存（草稿首存入库，正式带 revision 乐观锁）/
// 删除 / 打开。数据模型对齐后端 WorkflowDocument（nodes/lines 全量内联）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface WorkflowsFace {
  loadWorkflows(): Promise<void>
  /** 新建本地草稿（_draft 标记；首次保存时真正入库）。 */
  createWorkflowDraft(name: string): WorkflowDocument
  /** 保存画布（草稿入库 / 正式带 revision 更新）。 */
  saveWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowDocument | null>
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
  const loadWorkflows = useCallback(async () => {
    // 会话未激活时跳过（后端 requires sessionId 400）
    if (!sessionId) {
      dispatch({ type: 'WORKFLOWS_LOADED', items: [] })
      return
    }
    const items = await remote.call(EP.EP_LIST_WORKFLOWS, { sessionId })
    dispatch({ type: 'WORKFLOWS_LOADED', items: Array.isArray(items) ? (items as WorkflowDocument[]) : [] })
  }, [dispatch, remote, sessionId])

  const createWorkflowDraft = useCallback((name: string): WorkflowDocument => {
    const now = new Date().toISOString()
    const draft: WorkflowDocument = {
      id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      mode: 'mode1',
      name,
      description: '',
      revision: 0,
      nodes: [],
      lines: [],
      createdAt: now,
      // 草稿标记（未入库；保存时经 createWorkflow 真正创建）
      ...({ _draft: true } as object),
    } as WorkflowDocument
    dispatch({ type: 'WORKFLOW_ADDED', flow: draft })
    return draft
  }, [dispatch, sessionId])

  const saveWorkflow = useCallback(async (
    flow: WorkflowDocument,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
  ): Promise<WorkflowDocument | null> => {
    const serialized = serializeWorkflow(flow, nodes, edges)
    const draft = (flow as unknown as { _draft?: boolean })._draft === true
    let saved: WorkflowDocument
    if (draft) {
      const created = await remote.call(EP.EP_CREATE_WORKFLOW, {
        sessionId,
        name: String(serialized.name ?? '').trim() || '未命名工作流',
        description: String(serialized.description ?? ''),
      }) as WorkflowDocument
      if ((serialized.nodes?.length ?? 0) > 0 || (serialized.lines?.length ?? 0) > 0) {
        saved = await remote.call(EP.EP_PUT_WORKFLOW, {
          sessionId,
          flow: { ...serialized, id: created.id, revision: created.revision },
        }) as WorkflowDocument
      } else {
        saved = created
      }
    } else {
      saved = await remote.call(EP.EP_PUT_WORKFLOW, {
        sessionId,
        flow: serialized,
      }) as WorkflowDocument
    }
    dispatch({ type: 'WORKFLOW_UPDATED', flow: saved })
    return saved
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
    saveWorkflow,
    deleteWorkflow,
    openFlow,
  }
}
