// src/client/hooks/useWorkflows.ts
//
// 工作流列表：加载 / 新建草稿 / 保存（草稿首存入库，正式带 revision 乐观锁）/
// 删除 / 打开。数据模型对齐后端 WorkflowDocument（nodes/lines 全量内联）。

import { useCallback, useRef } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { Drafted, StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
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

  /** 在途保存 Promise（快速双击/重复触发时共享同一请求，避免第二次携带旧 revision 触发 409）。 */
  const saveInflight = useRef<Promise<WorkflowDocument | null> | null>(null)

  const saveWorkflow = useCallback(async (
    flow: WorkflowDocument,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
  ): Promise<WorkflowDocument | null> => {
    // 并发去重：上一次保存尚未返回时，重复调用直接复用同一在途请求（相同入参
    // 的第二次点击结果一致；捕获 409 后会清空，用户可再次点击重试）。
    if (saveInflight.current) return saveInflight.current
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
    saveInflight.current = task
    try {
      return await task
    } finally {
      if (saveInflight.current === task) saveInflight.current = null
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
    saveWorkflow,
    deleteWorkflow,
    openFlow,
  }
}
