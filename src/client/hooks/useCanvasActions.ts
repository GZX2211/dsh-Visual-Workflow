// src/client/hooks/useCanvasActions.ts
//
// 画布编辑操作面：节点放置（模板深拷贝/父代理/阶段/协作组/入组）、连线
// 校验与增删、删除级联、整理布局、清空画布、虚拟节点复制与协作组成员
// 移除。变更统一走 dispatch；涉及图标量变化前先 history.remember()。
//
// 本次改造（用户裁决）：
//   - 画布节点删除不再二次确认（直接删除）；
//   - 清空画布不再二次确认（运行中由工具栏禁用按钮拦截）；
//   - 运行中实例画布锁定（run-locks）：已完成/执行中流程不可删除、不可改线；
//   - 纯 XY 拖动 / 协作组卡片缩放 = 几何改动 → 防抖自动保存（不弹确认、静默落盘）。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction, StudioState, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import { currentFlowOf, currentFlowTemplateOf, currentServiceOf } from '../studio/studio-state.js'
import type { GraphHistoryFace } from './useGraphHistory.js'
import type { ToastFace } from './useToast.js'
import type { SaveCanvasOptions } from './useDocumentActions.js'
import type { RunLockSet } from '../lib/run-locks.js'
import type { Dict } from '../i18n.js'
import {
  connectionProblem, connectionProblemMessage, consolidateGroups, dropNodeFlowLines, flowToCanvasLines,
  layoutNodes, joinNodeToGroup, stageTemplateKinds, templateToNodeData, type CanvasLine,
} from '../lib/graph-model.js'

/** 几何拖动（节点拖动 / 组卡片缩放）自动保存的防抖窗口（毫秒）。 */
export const GEOMETRY_AUTOSAVE_DEBOUNCE_MS = 400

/** 画布编辑面的外部依赖注入（锁定判定 + 自动保存）。 */
export interface CanvasActionsOptions {
  /** 运行中实例画布锁定判定集（模式一 running；未启用时全部解锁）。 */
  locks: RunLockSet
  /** 画布保存入口（纯几何改动的防抖自动保存用；auto:true = 静默落库）。 */
  saveCanvas(options?: SaveCanvasOptions): Promise<unknown>
}

export interface CanvasActionsFace {
  rememberGraph(): void
  moveNode(id: string, position: { x: number; y: number }): void
  onNodeDragStart(): void
  onConnect(connection: { source: string; target: string; sourceHandle: string; targetHandle: string }): void
  onConnectionRejected(): void
  tidyGraph(): void
  clearGraph(): void
  removeSelected(): void
  removeNodeNow(id: string): void
  removeLine(id: string): void
  placeTemplateNode(kind: 'role' | 'file' | 'database', templateId: string, position: { x: number; y: number }): void
  placeParentNode(templateId: string, position: { x: number; y: number }): void
  placeStageNode(kind: string, position: { x: number; y: number }): void
  placeGroupNode(position: { x: number; y: number }): void
  /** 协作组模板拖入画布：按模板名称/协作 Prompt 生成协作组节点。 */
  placeGroupFromTemplate(templateId: string, position: { x: number; y: number }): void
  placeTemplateIntoGroup(kind: 'role', templateId: string, groupId: string, position: { x: number; y: number }): void
  onGroupResize(id: string, size: { w: number; h: number }): void
  addNodeToGroup(nodeId: string, groupId: string): void
  copyToProxy(): void
  removeGroupMember(memberId: string): void
  /** 交换节点左右连接点（节点属性 swapPorts 取反；可撤销）。 */
  swapNodePorts(id: string): void
}

/** 画布编辑面（remember 需在变更 dispatch 前调用；远端 IO 仅几何自动保存一处）。 */
export function useCanvasActions(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  history: GraphHistoryFace,
  t: Dict,
  options: CanvasActionsOptions,
): CanvasActionsFace {
  const { locks, saveCanvas } = options
  /** 几何自动保存防抖计时器（跨渲染保持；卸载时清理，避免迟到保存）。 */
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 当前画布对象是否可自动保存（无对象/本地草稿态跳过——草稿须手动保存/创建实例）。 */
  const canAutoSave = useCallback((): boolean => {
    if (!state.currentId) return false
    const doc = state.currentKind === 'flowTemplate'
      ? currentFlowTemplateOf(state)
      : state.currentKind === 'workflow'
        ? currentFlowOf(state)
        : state.currentKind === 'service'
          ? currentServiceOf(state)
          : null
    if (!doc) return false
    return (doc as { _draft?: boolean })._draft !== true
  }, [state])

  /** 纯几何改动（拖动/缩放）→ 防抖自动保存（静默落库；草稿态不自动落库）。 */
  const scheduleGeometryAutoSave = useCallback((): void => {
    if (!canAutoSave()) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null
      void saveCanvas({ auto: true })
    }, GEOMETRY_AUTOSAVE_DEBOUNCE_MS)
  }, [canAutoSave, saveCanvas])

  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
  }, [])

  // ---------- 画布操作 ----------
  const rememberGraph = useCallback(() => {
    history.remember()
  }, [history])

  const moveNode = useCallback((id: string, position: { x: number; y: number }) => {
    dispatch({ type: 'NODE_MOVED', id, position })
    scheduleGeometryAutoSave()
  }, [dispatch, scheduleGeometryAutoSave])

  const onNodeDragStart = useCallback(() => {
    history.remember()
  }, [history])

  const onConnect = useCallback((connection: { source: string; target: string; sourceHandle: string; targetHandle: string }) => {
    // 运行中锁定：已完成节点不得再接出线，已完成/执行中节点不得再接左入口线
    // （反馈沿用既有「无效连线」toast，用户裁决）
    if (!locks.canConnect(connection.source, connection.target)) {
      notify('error', t.invalidConnection)
      return
    }
    const problem = connectionProblem(
      state.canvas.nodes as unknown as import('../../host/shared/graph-model.js').GraphNode[],
      state.canvas.edges as unknown as CanvasLine[],
      connection,
    )
    if (!problem.valid) {
      notify('error', connectionProblemMessage(problem as { valid: boolean; code: string }, t as unknown as Record<string, string>))
      return
    }
    history.remember()
    const edge: CanvasEdge = {
      id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle as CanvasEdge['sourceHandle'],
      targetHandle: connection.targetHandle as CanvasEdge['targetHandle'],
    }
    dispatch({ type: 'EDGE_ADDED', edge })
  }, [dispatch, history, locks, notify, state.canvas.nodes, state.canvas.edges, t])

  const onConnectionRejected = useCallback(() => {
    notify('error', t.invalidConnection)
  }, [notify, t.invalidConnection])

  const tidyGraph = useCallback(() => {
    history.remember()
    // 布局统一走 lib/graph-model 的 layoutNodes（Bug 25：删除了 Studio.tsx 内
    // 重复实现的 flowLayout，避免两份布局算法漂移）。
    const next = layoutNodes(state.canvas.nodes, flowToCanvasLines(state.canvas.edges))
    dispatch({ type: 'GRAPH_REPLACED', nodes: next, edges: state.canvas.edges, dirty: true })
    // 整理布局 = 批量坐标改动（纯几何）：同样防抖自动保存（不构成编排变更）
    scheduleGeometryAutoSave()
    notify('success', t.toastTidy)
  }, [dispatch, history, notify, scheduleGeometryAutoSave, state.canvas.edges, state.canvas.nodes, t.toastTidy])

  /** 清空画布：无二次确认（用户裁决）；运行中由工具栏禁用入口，此处不重复拦截。 */
  const clearGraph = useCallback(() => {
    history.remember()
    dispatch({ type: 'GRAPH_REPLACED', nodes: [], edges: [], dirty: true })
    dispatch({ type: 'CLEAR_SELECTION' })
    notify('info', t.toastCleared)
  }, [dispatch, history, notify, t.toastCleared])

  const removeNodeNow = useCallback((id: string) => {
    // 运行中锁定（防御性二次拦截：调用点可能不止 removeSelected）
    if (locks.isNodeLocked(id)) return
    history.remember()
    // 组内成员离开协作组：清除成员关系（§4.2.5.2）
    const node = state.canvas.nodes.find((item) => item.id === id)
    const groupId = node?.kind === 'parent' || node?.kind === 'agent' ? (node.data.groupId as string | null | undefined) : null
    // 级联删除集合：主节点 + 其全部虚拟引用节点（需求 §4.2.3.2 规则 5 / Bug 4）
    const removed = new Set<string>([id])
    if (node && (node.kind === 'parent' || node.kind === 'agent')) {
      for (const item of state.canvas.nodes) {
        if (item.kind === 'proxy' && (item as { proxySourceId?: unknown }).proxySourceId === id) removed.add(item.id)
      }
    }
    if (groupId) {
      dispatch({
        type: 'GRAPH_REPLACED',
        nodes: state.canvas.nodes.filter((item) => !removed.has(item.id)).map((item) => item.kind === 'group' && ((item.data.memberIds as string[] | undefined) ?? []).includes(id)
          ? { ...item, data: { ...item.data, memberIds: (item.data.memberIds as string[]).filter((memberId) => memberId !== id) } }
          : item),
        edges: state.canvas.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
        dirty: true,
      })
    } else {
      // NODE_REMOVED reducer 已实现同级联删除（虚拟引用随主节点一并移除）
      dispatch({ type: 'NODE_REMOVED', id })
    }
    dispatch({ type: 'CLEAR_SELECTION' })
    notify('info', t.toastDeleted)
  }, [dispatch, history, locks, notify, state.canvas.edges, state.canvas.nodes, t.toastDeleted])

  /** 删除选中节点：无二次确认（用户裁决）；运行中锁定项静默忽略。 */
  const removeSelected = useCallback(() => {
    if (!state.selection.nodeId) return
    const id = state.selection.nodeId
    const node = state.canvas.nodes.find((item) => item.id === id)
    if (!node) return
    // 运行中锁定：已完成/执行中的节点不可删除（静默忽略；无 toast，用户裁决）
    if (locks.isNodeLocked(id)) return
    removeNodeNow(id)
  }, [locks, removeNodeNow, state.canvas.nodes, state.selection.nodeId])

  const removeLine = useCallback((id: string) => {
    // 运行中锁定：已完成流程的连线与执行中节点左入口连线不可删除（静默忽略）
    if (locks.isEdgeLocked(id)) return
    history.remember()
    dispatch({ type: 'EDGE_REMOVED', id })
    dispatch({ type: 'CLEAR_SELECTION' })
    notify('info', t.toastDeleted)
  }, [dispatch, history, locks, notify, t.toastDeleted])

  // ---------- 画布节点放置（模板深拷贝，§4.2.1） ----------
  const placeTemplateNode = useCallback((kind: 'role' | 'file' | 'database', templateId: string, position: { x: number; y: number }) => {
    if (!state.currentId) return
    const template = state.templates[kind].find((item) => item.id === templateId)
    if (!template) return
    const data = templateToNodeData(kind, template) ?? {}
    const nodeKind = kind === 'role' ? 'agent' : kind
    const node: CanvasNode = {
      id: `${nodeKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: nodeKind as CanvasNode['kind'],
      position,
      data,
    }
    history.remember()
    dispatch({ type: 'NODE_ADDED', node })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastNodeAdded)
  }, [dispatch, history, notify, state.currentId, state.templates, t.toastNodeAdded])

  /** 放置父代理节点（每画布最多一个，§4.2.3.1 规则 5）。 */
  const placeParentNode = useCallback((templateId: string, position: { x: number; y: number }) => {
    if (!state.currentId) return
    if (state.canvas.nodes.some((item) => item.kind === 'parent')) {
      notify('error', t.parentDuplicatedHint)
      return
    }
    const template = state.templates.role.find((item) => item.id === templateId)
    const data = templateToNodeData('role', template) ?? {}
    const node: CanvasNode = {
      id: `parent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'parent',
      position,
      data,
    }
    history.remember()
    dispatch({ type: 'NODE_ADDED', node })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastNodeAdded)
  }, [dispatch, history, notify, state.canvas.nodes, state.currentId, state.templates.role, t.parentDuplicatedHint, t.toastNodeAdded])

  /** 放置阶段节点（启动/结束各一，§4.2.5.1）。 */
  const placeStageNode = useCallback((kind: string, position: { x: number; y: number }) => {
    if (!state.currentId) return
    if ((kind === 'start' || kind === 'end') && state.canvas.nodes.some((item) => item.kind === kind)) {
      notify('error', t.stageDuplicatedHint)
      return
    }
    const labels = stageTemplateKinds(state.mode)
    const label = labels.find((item) => item.kind === kind)?.label ?? kind
    const node: CanvasNode = {
      id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: kind as CanvasNode['kind'],
      position,
      data: { label },
    }
    history.remember()
    dispatch({ type: 'NODE_ADDED', node })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastNodeAdded)
  }, [dispatch, history, notify, state.canvas.nodes, state.currentId, state.mode, t.stageDuplicatedHint, t.toastNodeAdded])

  /** 放置协作组节点。 */
  const placeGroupNode = useCallback((position: { x: number; y: number }) => {
    if (!state.currentId) return
    const node: CanvasNode = {
      id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'group',
      position,
      data: { label: String(t.groupDefaultName ?? '协作组'), collabPrompt: '', memberIds: [], size: { w: 300, h: 220 } },
    }
    history.remember()
    dispatch({ type: 'NODE_ADDED', node })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastNodeAdded)
  }, [dispatch, history, notify, state.currentId, t.groupDefaultName, t.toastNodeAdded])

  /** 协作组模板拖入画布：按模板内容生成协作组节点（用户批注：协作组模板列表）。 */
  const placeGroupFromTemplate = useCallback((templateId: string, position: { x: number; y: number }) => {
    if (!state.currentId) return
    const template = state.templates.group.find((item) => item.id === templateId)
    const data = template
      ? {
          label: String((template as unknown as { name?: unknown }).name ?? ''),
          collabPrompt: String((template as unknown as { collabPrompt?: unknown }).collabPrompt ?? ''),
          memberIds: [],
          size: { w: 300, h: 220 },
        }
      : { label: String(t.groupDefaultName ?? '协作组'), collabPrompt: '', memberIds: [], size: { w: 300, h: 220 } }
    const node: CanvasNode = {
      id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'group',
      position,
      data,
    }
    history.remember()
    dispatch({ type: 'NODE_ADDED', node })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastNodeAdded)
  }, [dispatch, history, notify, state.currentId, state.templates.group, t.groupDefaultName, t.toastNodeAdded])

  /** 左栏角色模板拖入协作组：生成节点并直接登记为组内成员。 */
  const placeTemplateIntoGroup = useCallback((kind: 'role', templateId: string, groupId: string, position: { x: number; y: number }) => {
    if (!state.currentId) return
    const template = state.templates[kind].find((item) => item.id === templateId)
    const group = state.canvas.nodes.find((item) => item.id === groupId)
    if (!template || !group || group.kind !== 'group') return
    const members = (group.data.memberIds as string[] | undefined) ?? []
    if (members.length >= 8) {
      notify('error', t.groupMemberLimitHint)
      return
    }
    const data = templateToNodeData(kind, template) ?? {}
    const node: CanvasNode = {
      id: `${kind === 'role' ? 'agent' : kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'agent',
      position: { x: group.position.x + 10, y: group.position.y + 10 },
      data: { ...data, groupId },
    }
    history.remember()
    // 原子入组：一次变更同时写 node.groupId + 组 memberIds（追加去重），杜绝「卡有成员/列表空/只显示一个」
    const nodes = joinNodeToGroup([...state.canvas.nodes, node], node.id, groupId)
    dispatch({ type: 'GRAPH_REPLACED', nodes, edges: dropNodeFlowLines(state.canvas.edges, node.id), dirty: true })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastGroupMemberAdded)
  }, [dispatch, history, notify, state.canvas.edges, state.canvas.nodes, state.currentId, state.templates, t.groupMemberLimitHint, t.toastGroupMemberAdded])

  const onGroupResize = useCallback((id: string, size: { w: number; h: number }) => {
    dispatch({ type: 'NODE_DATA_PATCH', id, patch: { size } })
    // 卡片缩放属纯几何改动：防抖自动保存（不弹运行中确认、不构成编排变更）
    scheduleGeometryAutoSave()
  }, [dispatch, scheduleGeometryAutoSave])

  /** 角色节点拖入协作组（§4.2.5.2 规则 1）：成员标记 groupId + 组 memberIds 登记（原子追加，防止不一致）。 */
  const addNodeToGroup = useCallback((nodeId: string, groupId: string) => {
    // 运行中锁定：已完成/执行中节点入组会断开其原有流程连线（dropNodeFlowLines），
    // 等于改写已跑完/执行中的流程 → 直接忽略
    if (locks.isNodeLocked(nodeId)) return
    const group = state.canvas.nodes.find((item) => item.id === groupId)
    if (!group || group.kind !== 'group') return
    const node = state.canvas.nodes.find((item) => item.id === nodeId)
    if (!node || (node.kind !== 'parent' && node.kind !== 'agent')) return
    const members = (group.data.memberIds as string[] | undefined) ?? []
    if (members.includes(nodeId)) return
    if (members.length >= 8) {
      notify('error', t.groupMemberLimitHint)
      return
    }
    history.remember()
    // 入组时自动断开该节点原有的流程连线（组内成员仅上下文/数据库线，§4.2.5.2 规则 4）
    dispatch({ type: 'GRAPH_REPLACED', nodes: joinNodeToGroup(state.canvas.nodes, nodeId, groupId), edges: dropNodeFlowLines(state.canvas.edges, nodeId), dirty: true })
    notify('success', t.toastGroupMemberAdded)
  }, [dispatch, history, locks, notify, state.canvas.edges, state.canvas.nodes, t.groupMemberLimitHint, t.toastGroupMemberAdded])

  // ---------- 虚拟节点（复制） ----------
  const copyToProxy = useCallback(() => {
    if (!state.selection.nodeId) return
    const main = state.canvas.nodes.find((item) => item.id === state.selection.nodeId)
    if (!main || (main.kind !== 'parent' && main.kind !== 'agent')) return
    history.remember()
    const id = `proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    dispatch({
      type: 'NODE_ADDED',
      node: {
        id,
        kind: 'proxy',
        position: { x: main.position.x + 40, y: main.position.y + 120 },
        data: {},
        proxySourceId: main.id,
      } as CanvasNode,
    })
    dispatch({ type: 'SELECT_NODE', id })
    notify('info', t.toastProxyCreated)
  }, [dispatch, history, notify, state.canvas.nodes, state.selection.nodeId, t.toastProxyCreated])

  // ---------- 协作组成员移除 ----------
  // 先合并重复协作组节点（memberIds 并集，且对每个组去重），得到**唯一**权威组；
  // 再从去重后的成员列表里移除该成员（一次只删一个，即使历史数据里该 id 重复出现），
  // 同时只清空目标成员的 groupId —— 杜绝「删 1 个却移出多个 / 无论点哪个都移出 2 个」。
  const removeGroupMember = useCallback((memberId: string) => {
    // 运行中锁定：已完成/执行中成员退出协作组会改变已跑完/执行中的协作结构 → 忽略
    if (locks.isNodeLocked(memberId)) return
    const base = consolidateGroups(state.canvas.nodes)
    const member = base.find((item) => item.id === memberId)
    const groupId = member && (member.kind === 'parent' || member.kind === 'agent')
      ? (member.data.groupId as string | null | undefined) ?? null
      : null
    if (!groupId) return
    const group = base.find((item) => item.id === groupId && item.kind === 'group')
    if (!group) return
    history.remember()
    const deduped = [...new Set(Array.isArray(group.data.memberIds) ? group.data.memberIds as string[] : [])]
    const nextMembers = deduped.filter((item) => item !== memberId)
    const nodes = base.map((n) => {
      if (n.id === groupId && n.kind === 'group') return { ...n, data: { ...n.data, memberIds: nextMembers } }
      if (n.id === memberId) return { ...n, data: { ...n.data, groupId: null } }
      return n
    })
    dispatch({ type: 'GRAPH_REPLACED', nodes, edges: state.canvas.edges, dirty: true })
  }, [dispatch, history, locks, state.canvas.edges, state.canvas.nodes])

  // ---------- 交换节点左右连接点（用户批注：美化布线防交叉；状态随节点持久化） ----------
  const swapNodePorts = useCallback((id: string) => {
    const node = state.canvas.nodes.find((item) => item.id === id)
    if (!node) return
    history.remember()
    dispatch({ type: 'NODE_DATA_PATCH', id, patch: { swapPorts: (node.data as { swapPorts?: unknown }).swapPorts !== true } })
  }, [dispatch, history, state.canvas.nodes])

  return {
    rememberGraph, moveNode, onNodeDragStart, onConnect, onConnectionRejected,
    tidyGraph, clearGraph, removeSelected, removeNodeNow, removeLine,
    placeTemplateNode, placeParentNode, placeStageNode, placeGroupNode, placeGroupFromTemplate, placeTemplateIntoGroup,
    onGroupResize, addNodeToGroup, copyToProxy, removeGroupMember, swapNodePorts,
  }
}
