// src/client/hooks/useWorkflows.ts
//
// 工作流列表：加载 / 新建草稿 / 保存（草稿首存入库，正式带 revision 乐观锁）/
// 删除 / 打开。数据模型对齐后端 WorkflowDocument（nodes/lines 全量内联）。
//
// 工作台全局化改版：
//   - loadWorkflows 返回**全部会话**的实例（工作台全局面板数据源；不按会话过滤）；
//   - instantiateFromTemplate 以「目标会话 id」为参数（创建实例时决定：当前主会话
//     或新建主会话；「开启新会话」为一次性临时选项，实例文档不再继承该字段）；
//   - saveWorkflow 以实例自身 sessionId 归属（运行/历史/状态都以实例绑定的会话为准）。

import { useCallback, useRef } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { Drafted, StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface WorkflowsFace {
  /** 加载工作流实例列表（全部会话）；返回加载的条目（供「进入工作台自动选中实例」复用）。 */
  loadWorkflows(): Promise<WorkflowDocument[]>
  /** 新建本地草稿（_draft 标记；首次保存时真正入库；目标会话 = 当前主会话）。 */
  createWorkflowDraft(name: string, sessionId: string): WorkflowDocument
  /** 保存画布（草稿入库 / 正式带 revision 更新）。 */
  saveWorkflow(flow: WorkflowDocument, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<WorkflowDocument | null>
  /**
   * 模板 → 实例：深拷贝模板内容创建实例草图（绑定目标会话；不落盘，由调用方
   * saveWorkflow）。「开启新会话/工作区」为一次性临时选项，不继承到实例文档。
   * fallbackName：模板无名称时的默认名（调用方从词典注入）。
   */
  instantiateFromTemplate(template: WorkflowTemplate, targetSessionId: string, fallbackName: string): WorkflowDocument
  deleteWorkflow(flow: WorkflowDocument): Promise<void>
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

/** 待补发的最新画布内容（在途保存期间到达的后一次保存）。 */
interface PendingSave {
  flow: WorkflowDocument
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

/**
 * 在途保存条目（按 flowId 区分；尾随合并）：
 *   - promise：本次在途的「首存 + 尾随补发」链，完成前复用给同 flowId 的后续调用；
 *   - pending：在途期间到达的最新内容，当前请求完成后用它补发一次（后到内容不会被丢弃）。
 */
interface SaveInflightEntry {
  flowId: string
  promise: Promise<WorkflowDocument | null>
  pending: PendingSave | null
}

/** 工作流列表面（远端失败抛错，由调用方 toast）。 */
export function useWorkflows(
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
): WorkflowsFace {
  /** 加载全部会话的实例列表（工作台全局化：不按当前会话过滤）。 */
  const loadWorkflows = useCallback(async (): Promise<WorkflowDocument[]> => {
    const items = await remote.call(EP.EP_LIST_WORKFLOWS, {}) as unknown
    const list = Array.isArray(items) ? (items as WorkflowDocument[]) : []
    dispatch({ type: 'WORKFLOWS_LOADED', items: list })
    return list
  }, [dispatch, remote])

  const createWorkflowDraft = useCallback((name: string, sessionId: string): WorkflowDocument => {
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
  }, [dispatch])

  /**
   * 模板 → 实例：深拷贝模板（节点/连线全量内联，与模板完全断引用——§4.2.1 解耦语义）。
   * 目标会话由调用方决定（当前主会话 / 新建主会话）；不继承 startNewSession/workspacePath
   * （一次性临时选项，字段已退役）。fallbackName 由调用方从词典注入（模板无名称时使用）。
   */
  const instantiateFromTemplate = useCallback((template: WorkflowTemplate, targetSessionId: string, fallbackName: string): WorkflowDocument => {
    const now = new Date().toISOString()
    const draft = {
      id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: targetSessionId,
      mode: template.mode,
      name: template.name ?? fallbackName,
      description: template.description ?? '',
      revision: 0,
      nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as WorkflowDocument['nodes'],
      lines: JSON.parse(JSON.stringify(template.lines ?? [])) as WorkflowDocument['lines'],
      // 元参数（模板层 → 实例层）：深拷贝一份，实例后续调整预算不回流污染模板
      ...(template.meta ? { meta: JSON.parse(JSON.stringify(template.meta)) as WorkflowDocument['meta'] } : {}),
      createdAt: now,
      _draft: true,
    } as Drafted<WorkflowDocument>
    dispatch({ type: 'WORKFLOW_ADDED', flow: draft })
    return draft
  }, [dispatch])

  /** 在途保存条目（快速双击/重复触发时合并到同一在途链，避免第二次携带旧 revision 触发 409）。 */
  const saveInflight = useRef<SaveInflightEntry | null>(null)

  const saveWorkflow = useCallback(async (
    flow: WorkflowDocument,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
  ): Promise<WorkflowDocument | null> => {
    // 并发去重 + 尾随合并（Bug 清单 P1）：上一次保存尚未返回时再次保存同一工作流，
    // **不得**把后一次的新内容丢掉——登记为 pending，当前请求完成后用最新内容补发
    // 一次，调用方拿到的是「包含自己内容的最终落库结果」。去重必须按 flowId 区分：
    // 否则切换工作流后保存会复用前一工作流的 Promise，新工作流内容根本没被持久化。
    const inflight = saveInflight.current
    if (inflight?.flowId === flow.id) {
      inflight.pending = { flow, nodes, edges }
      return inflight.promise
    }
    /** 单次真实落库（序列化 → PUT → 更新列表）。 */
    const runSave = async (input: PendingSave): Promise<WorkflowDocument | null> => {
      const serialized = serializeWorkflow(input.flow, input.nodes, input.edges)
      // 保存统一走 putWorkflow：后端在文档不存在时视为创建（revision 0 → 1），
      // id 保持不变——草稿首存不再另 assign id，避免 WORKFLOW_UPDATED 无法命中
      // 列表项、当前画布继续引用旧草稿 id（旧实现每次保存都新建一个副本，
      // 用户感知「保存成功但实际没保存」）。
      // 归属会话 = 实例自身 sessionId（工作台全局化：实例与运行/校验同会话）。
      const saved = await remote.call(EP.EP_PUT_WORKFLOW, {
        sessionId: input.flow.sessionId,
        flow: serialized,
      }) as WorkflowDocument
      dispatch({ type: 'WORKFLOW_UPDATED', flow: saved })
      return saved
    }
    const entry: SaveInflightEntry = { flowId: flow.id, pending: null, promise: Promise.resolve(null) }
    entry.promise = (async (): Promise<WorkflowDocument | null> => {
      let last = await runSave({ flow, nodes, edges })
      // 首存返回后，若期间又到达了保存请求 → 用最新内容补发（循环处理补发期间的新请求）
      while (entry.pending) {
        const queued = entry.pending
        entry.pending = null
        last = await runSave(queued)
      }
      return last
    })()
    saveInflight.current = entry
    try {
      return await entry.promise
    } finally {
      // 仅当仍是自己的在途条目时清空（期间切到别的工作流保存时不得覆盖其条目）
      if (saveInflight.current === entry) saveInflight.current = null
    }
  }, [dispatch, remote])

  const deleteWorkflow = useCallback(async (flow: WorkflowDocument) => {
    await remote.call(EP.EP_DELETE_WORKFLOW, { sessionId: flow.sessionId, id: flow.id })
    dispatch({ type: 'WORKFLOW_REMOVED', id: flow.id })
  }, [dispatch, remote])

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
