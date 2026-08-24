// src/client/studio/Studio.tsx
//
// 工作台主组件（照搬旧项目 studio.js 的布局与交互流程，TSX 化 + 新模型装配）：
//   窗口内完整工作台 = 标题顶栏（工作流设计器 + 导入/导出/模式/组合 + 关闭）
//   + 画布控制栏 + 三栏（左侧库 / 画布 / 右侧属性面板）。
//   状态机（studio-state）与 hooks 负责数据与远端；本组件负责装配与交互编排：
//   模板深拷贝拖入、连线校验、撤销重做、未保存守卫、运行/服务启停与轮询、历史与断点恢复。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dict } from '../i18n.js'
import { useStudioState } from '../hooks/useStudioState.js'
import { useRemote, type RemoteFace } from '../hooks/useRemote.js'
import { useToast } from '../hooks/useToast.js'
import { useWorkflows } from '../hooks/useWorkflows.js'
import { useTemplates } from '../hooks/useTemplates.js'
import { useSelection } from '../hooks/useSelection.js'
import { useGraphHistory } from '../hooks/useGraphHistory.js'
import { useUnsavedGuard } from '../hooks/useUnsavedGuard.js'
import { useRunControl } from '../hooks/useRunControl.js'
import { useRunPolling } from '../hooks/useRunPolling.js'
import { useServiceControl } from '../hooks/useServiceControl.js'
import { useModeSwitch } from '../hooks/useModeSwitch.js'
import { usePanelLayout } from '../hooks/usePanelLayout.js'
import {
  currentFlowOf, currentServiceOf, editorDataOf, isRunningOf,
  type CanvasNode, type CanvasEdge, type LibSelKind, type LibTab,
} from './studio-state.js'
import { EP } from '../lib/remote.js'
import { GraphCanvas, type CanvasApi } from '../components/canvas/GraphCanvas.js'
import { LeftPanel, type DragPayload } from '../components/sidebar/LeftPanel.js'
import { Toolbar } from '../components/toolbar/Toolbar.js'
import { Inspector } from '../components/panels/inspector/Inspector.js'
import { ConfirmDialog } from '../components/confirm-dialog/ConfirmDialog.js'
import { RunHistory } from '../components/run-history/RunHistory.js'
import { ServiceConsole } from '../components/service-console/ServiceConsole.js'
import { ComboManager } from '../components/combo-manager/ComboManager.js'
import {
  connectionProblem, connectionProblemMessage, flowToCanvasLines, templateToNodeData,
  runStatusMap, stageTemplateKinds, type CanvasLine,
} from '../lib/graph-model.js'
import { readFileAsText, readFileAsBase64, download } from '../lib/files.js'
import { isRoleTemplateBundle } from '../lib/bundle.js'

export interface StudioProps {
  /** 文案词典。 */
  t: Dict
  /** 绑定的会话 id。 */
  sessionId: string
  /** 远端调用面（测试注入；缺省 useRemote）。 */
  remote?: RemoteFace
  /** 窗口关闭回调（标题栏 ×；浮窗宿主注入；对话视图挂载无关闭）。 */
  onClose?: () => void
  /** 窗口拖动把手回调（浮窗注入；工作台标题顶栏兼任窗口标题栏拖动）。 */
  onTitlebarDrag?: (event: React.PointerEvent) => void
}

export function Studio({ t, sessionId, remote: remoteProp, onClose, onTitlebarDrag }: StudioProps) {
  const remote = remoteProp ?? useRemote()
  const { state, dispatch } = useStudioState(sessionId)
  const { toast, toastError } = useToast(dispatch)
  const workflows = useWorkflows(dispatch, remote, state.sessionId)
  const templates = useTemplates(dispatch, remote)
  const selection = useSelection(dispatch)
  const history = useGraphHistory(state, dispatch)
  const guard = useUnsavedGuard(state, dispatch)
  const runControl = useRunControl(dispatch, remote)
  const serviceControl = useServiceControl(dispatch, remote)
  const modeSwitch = useModeSwitch(dispatch)
  const panels = usePanelLayout(state, dispatch)
  useRunPolling(state.run.runId, dispatch, remote)

  const canvasApiRef = useRef<CanvasApi | null>(null)
  const canvasShellRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ payload: DragPayload; startX: number; startY: number; preview: { x: number; y: number } | null } | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const libraryImportRef = useRef<HTMLInputElement | null>(null)
  const personaInputRef = useRef<HTMLInputElement | null>(null)
  const groupMdInputRef = useRef<HTMLInputElement | null>(null)

  const currentFlow = currentFlowOf(state)
  const currentService = currentServiceOf(state)
  const editorData = editorDataOf(state)
  const running = isRunningOf(state)
  const runStatusByNode = useMemo(() => runStatusMap(state.run.snapshot), [state.run.snapshot])

  // ---------- 初始化加载 ----------
  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      // 会话未激活（浮窗路径下为空）：不请求需要 sessionId 的端点（避免 400），
      // 提示用户在对话区先发送一条消息激活会话（会话出现后经 subscribe 重新挂载）
      if (state.sessionId) {
        try {
          await Promise.all([
            workflows.loadWorkflows(),
            serviceControl.loadServices(state.sessionId),
          ])
        } catch (error) {
          if (!cancelled) toastError(error)
        }
      } else {
        notify('info', t.currentSessionUnavailable)
      }
      try {
        await templates.loadTemplates()
        // 内置父代理模板：模板库首次启动时补齐（角色 Tab 置顶固定显示，§4.2.3.1）
        const roleItems = await remote.call(EP.EP_LIST_TEMPLATES, { kind: 'role' }) as Array<Record<string, unknown>>
        if (!(roleItems ?? []).some((item) => item.kind === 'parent')) {
          await templates.saveTemplate('role', {
            id: 'role-parent-builtin',
            kind: 'parent',
            name: '父代理',
            systemPrompt: '你是工作流编排的父代理，仅负责调度子代理、判断流程走向，不执行节点任务。',
            provider: '',
            model: '',
            presetId: 'standard',
            retryLimit: 3,
            reactLimit: null,
            inputSchema: '',
            outputSchema: '',
          } as never)
          await templates.loadTemplates()
        }
      } catch (error) {
        if (!cancelled) toastError(error)
      }
      const enums = async (): Promise<void> => {
        const [presets, tools, models, combos] = await Promise.all([
          remote.call(EP.EP_PRESETS).catch(() => []),
          remote.call(EP.EP_TOOLS).catch(() => []),
          remote.call(EP.EP_MODELS).catch(() => []),
          remote.call(EP.EP_TOOL_COMBOS).catch(() => []),
        ])
        if (cancelled) return
        dispatch({ type: 'PRESETS_LOADED', items: Array.isArray(presets) ? presets : [] })
        dispatch({ type: 'TOOLS_LOADED', items: Array.isArray(tools) ? tools : [] })
        dispatch({ type: 'MODELS_LOADED', items: Array.isArray(models) ? models : [] })
        dispatch({ type: 'COMBOS_LOADED', items: Array.isArray(combos) ? combos : [] })
      }
      await enums()
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId])

  useEffect(() => {
    dispatch({ type: 'SET_SESSION', sessionId })
  }, [dispatch, sessionId])

  // ---------- 轻提示 ----------
  const notify = useCallback((kind: 'info' | 'success' | 'error', text: string) => {
    toast(kind, text)
  }, [toast])

  // ---------- 模式名映射 ----------
  const modeName = useCallback((presetId: string | null | undefined): string => {
    const value = String(presetId ?? '')
    if (!value) return '—'
    const names = t.modeNames as Record<string, string>
    if (names[value]) return names[value]
    const preset = (state.presets as Array<{ id: string; name?: string }>).find((item) => item.id === value)
    if (preset) return preset.name ?? value
    const combo = state.combos.find((item) => item.id === value)
    if (combo) return combo.name
    return value
  }, [state.combos, state.presets, t.modeNames])

  // ---------- 保存 / 打开 ----------
  const saveCanvas = useCallback(async () => {
    if (state.currentKind === 'workflow') {
      const flow = currentFlowOf(state)
      if (!flow) return null
      try {
        const saved = await workflows.saveWorkflow(flow, state.canvas.nodes, state.canvas.edges)
        if (saved) {
          dispatch({ type: 'SET_DIRTY', dirty: false })
          notify('success', t.toastSaved)
        }
        return saved
      } catch (error) {
        toastError(error)
        return null
      }
    }
    if (state.currentKind === 'service') {
      const service = currentServiceOf(state)
      if (!service) return null
      try {
        const saved = await serviceControl.saveService(service, state.canvas.nodes, state.canvas.edges)
        if (saved) {
          dispatch({ type: 'SET_DIRTY', dirty: false })
          notify('success', t.toastSaved)
        }
        return saved
      } catch (error) {
        toastError(error)
        return null
      }
    }
    return null
  }, [dispatch, notify, state, toastError, workflows, serviceControl, t.toastSaved])

  const openFlowById = useCallback((id: string) => {
    const flow = state.workflows.find((item) => item.id === id)
    if (!flow) return
    workflows.openFlow(flow)
  }, [state.workflows, workflows])

  const openServiceById = useCallback((id: string) => {
    const service = state.services.find((item) => item.id === id)
    if (!service) return
    dispatch({ type: 'OPEN_SERVICE', service })
  }, [dispatch, state.services])

  /** 打开工作流/服务（未保存守卫后切换）。 */
  const selectWorkflow = useCallback((id: string) => {
    if (state.mode === 'mode1') {
      guard.guard(() => openFlowById(id))
    } else {
      guard.guard(() => openServiceById(id))
    }
  }, [guard, openFlowById, openServiceById, state.mode])

  // ---------- 新建 ----------
  const createNew = useCallback((tab: LibTab, section?: 'file' | 'database') => {
    if (tab === 'workflow') {
      if (state.mode === 'mode2') {
        serviceControl.createServiceDraft(t.newWorkflow, state.sessionId)
        notify('info', t.newWorkflow)
        return
      }
      const draft = workflows.createWorkflowDraft(t.newWorkflow)
      workflows.openFlow(draft)
      notify('info', t.newWorkflow)
      return
    }
    if (tab === 'role') {
      const template = templates.createTemplateDraft('role')
      selection.selectEditor({ source: 'template', kind: 'role', id: template.id })
      selection.selectLib('role', (template as { id: string }).id)
      notify('info', t.newTemplate)
      return
    }
    if (tab === 'data') {
      // 数据 Tab 分区独立新建：文件分区建文件模板、数据库分区建数据库模板
      const kind = section === 'database' ? 'database' : 'file'
      const template = templates.createTemplateDraft(kind)
      selection.selectEditor({ source: 'template', kind, id: template.id })
      selection.selectLib(kind, (template as { id: string }).id)
      notify('info', t.newTemplate)
      return
    }
  }, [notify, selection, serviceControl, state.mode, state.sessionId, t.newTemplate, t.newWorkflow, templates, workflows])

  // ---------- 画布操作 ----------
  const rememberGraph = useCallback(() => {
    history.remember()
  }, [history])

  const moveNode = useCallback((id: string, position: { x: number; y: number }) => {
    dispatch({ type: 'NODE_MOVED', id, position })
  }, [dispatch])

  const onNodeDragStart = useCallback(() => {
    history.remember()
  }, [history])

  const onConnect = useCallback((connection: { source: string; target: string; sourceHandle: string; targetHandle: string }) => {
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
  }, [dispatch, history, notify, state.canvas.nodes, state.canvas.edges, t])

  const onConnectionRejected = useCallback(() => {
    notify('error', t.invalidConnection)
  }, [notify, t.invalidConnection])

  const tidyGraph = useCallback(() => {
    history.remember()
    const next = flowLayout(state.canvas.nodes, state.canvas.edges)
    dispatch({ type: 'GRAPH_REPLACED', nodes: next, edges: state.canvas.edges, dirty: true })
    notify('success', t.toastTidy)
  }, [dispatch, history, notify, state.canvas.edges, state.canvas.nodes, t.toastTidy])

  const clearGraph = useCallback(() => {
    dispatch({
      type: 'CONFIRM_SET',
      confirm: {
        kind: 'confirmText',
        title: t.clearCanvas,
        message: t.clearCanvasHint,
        confirmLabel: t.clear,
        onConfirm: () => {
          history.remember()
          dispatch({ type: 'GRAPH_REPLACED', nodes: [], edges: [], dirty: true })
          dispatch({ type: 'CLEAR_SELECTION' })
          notify('info', t.toastCleared)
        },
      },
    })
  }, [dispatch, history, notify, t.clear, t.clearCanvas, t.clearCanvasHint, t.toastCleared])

  const removeSelected = useCallback(() => {
    if (!state.selection.nodeId) return
    const id = state.selection.nodeId
    const node = state.canvas.nodes.find((item) => item.id === id)
    if (!node) return
    // 虚拟节点级联提示（§4.2.3.2 规则 5）：删除主节点时通知其虚拟引用数量
    const proxies = node.kind === 'parent' || node.kind === 'agent'
      ? state.canvas.nodes.filter((item) => item.kind === 'proxy' && (item as { proxySourceId?: unknown }).proxySourceId === node.id)
      : []
    if (proxies.length > 0) {
      dispatch({
        type: 'CONFIRM_SET',
        confirm: {
          kind: 'confirmText',
          title: t.deleteNode,
          message: t.proxyCascadeHint.replace('{count}', String(proxies.length)),
          onConfirm: () => { removeNodeNow(id) },
        },
      })
      return
    }
    dispatch({
      type: 'CONFIRM_SET',
      confirm: { kind: 'confirmText', title: t.deleteNode, message: t.confirmDelete, onConfirm: () => { removeNodeNow(id) } },
    })
  }, [dispatch, state.canvas.nodes, state.selection.nodeId, t.confirmDelete, t.deleteNode, t.proxyCascadeHint])

  const removeNodeNow = useCallback((id: string) => {
    history.remember()
    // 组内成员离开协作组：清除成员关系（§4.2.5.2）
    const node = state.canvas.nodes.find((item) => item.id === id)
    const groupId = node?.kind === 'parent' || node?.kind === 'agent' ? (node.data.groupId as string | null | undefined) : null
    if (groupId) {
      dispatch({
        type: 'GRAPH_REPLACED',
        nodes: state.canvas.nodes.filter((item) => item.id !== id).map((item) => item.kind === 'group' && ((item.data.memberIds as string[] | undefined) ?? []).includes(id)
          ? { ...item, data: { ...item.data, memberIds: (item.data.memberIds as string[]).filter((memberId) => memberId !== id) } }
          : item),
        edges: state.canvas.edges.filter((edge) => edge.source !== id && edge.target !== id),
        dirty: true,
      })
    } else {
      dispatch({ type: 'NODE_REMOVED', id })
    }
    dispatch({ type: 'CLEAR_SELECTION' })
    notify('info', t.toastDeleted)
  }, [dispatch, history, notify, state.canvas.edges, state.canvas.nodes, t.toastDeleted])

  const removeLine = useCallback((id: string) => {
    history.remember()
    dispatch({ type: 'EDGE_REMOVED', id })
    dispatch({ type: 'CLEAR_SELECTION' })
    notify('info', t.toastDeleted)
  }, [dispatch, history, notify, t.toastDeleted])

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
    dispatch({
      type: 'GRAPH_REPLACED',
      nodes: [
        ...state.canvas.nodes,
        node,
        { ...group, data: { ...group.data, memberIds: [...members, node.id] } },
      ],
      edges: state.canvas.edges,
      dirty: true,
    })
    dispatch({ type: 'SELECT_NODE', id: node.id })
    notify('success', t.toastGroupMemberAdded)
  }, [dispatch, history, notify, state.canvas.edges, state.canvas.nodes, state.currentId, state.templates, t.groupMemberLimitHint, t.toastGroupMemberAdded])

  const onGroupResize = useCallback((id: string, size: { w: number; h: number }) => {
    dispatch({ type: 'NODE_DATA_PATCH', id, patch: { size } })
  }, [dispatch])

  /** 角色节点拖入协作组（§4.2.5.2 规则 1）：成员标记 groupId + 组 memberIds 登记。 */
  const addNodeToGroup = useCallback((nodeId: string, groupId: string) => {
    const node = state.canvas.nodes.find((item) => item.id === nodeId)
    const group = state.canvas.nodes.find((item) => item.id === groupId)
    if (!node || !group || group.kind !== 'group') return
    if (node.kind !== 'parent' && node.kind !== 'agent') return
    const members = (group.data.memberIds as string[] | undefined) ?? []
    if (members.includes(nodeId)) return
    if (members.length >= 8) {
      notify('error', t.groupMemberLimitHint)
      return
    }
    history.remember()
    dispatch({
      type: 'GRAPH_REPLACED',
      nodes: state.canvas.nodes.map((item) => {
        if (item.id === nodeId) return { ...item, data: { ...item.data, groupId } }
        if (item.id === groupId) return { ...item, data: { ...item.data, memberIds: [...members, nodeId] } }
        return item
      }),
      edges: state.canvas.edges,
      dirty: true,
    })
    notify('success', t.toastGroupMemberAdded)
  }, [dispatch, history, notify, state.canvas.edges, state.canvas.nodes, t.groupMemberLimitHint, t.toastGroupMemberAdded])

  // ---------- 左侧拖拽（pointer，照搬旧项目 beginLibraryDrag） ----------
  const beginLibraryDrag = useCallback((event: React.PointerEvent, payload: DragPayload) => {
    if (event.button !== undefined && event.button !== 0) return
    dragRef.current = {
      payload,
      startX: event.clientX,
      startY: event.clientY,
      preview: null,
    }
    const onMove = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.preview && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) > 5) {
        drag.preview = { x: moveEvent.clientX, y: moveEvent.clientY }
        setDragPreview({ x: moveEvent.clientX, y: moveEvent.clientY, label: payload.label })
      } else if (drag.preview) {
        drag.preview = { x: moveEvent.clientX, y: moveEvent.clientY }
        setDragPreview({ x: moveEvent.clientX, y: moveEvent.clientY, label: payload.label })
      }
    }
    const onUp = (upEvent: PointerEvent): void => {
      const drag = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragPreview(null)
      if (!drag?.preview) {
        payload.onClick?.()
        return
      }
      const rect = canvasShellRef.current?.getBoundingClientRect()
      if (!rect || upEvent.clientX < rect.left || upEvent.clientX > rect.right || upEvent.clientY < rect.top || upEvent.clientY > rect.bottom) {
        return
      }
      // 左栏角色模板直接拖入协作组：落点为组卡片时生成节点并入组（§4.2.5.2 规则 1）
      const groupEl = typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest?.('.wf-group-node') as HTMLElement | null
        : null
      const groupId = groupEl?.getAttribute('data-wf-node-id') ?? ''
      if (groupId && payload.onDropIntoGroup) {
        payload.onDropIntoGroup(groupId, {
          x: Math.round(groupEl!.getBoundingClientRect().left - rect.left),
          y: Math.round(groupEl!.getBoundingClientRect().top - rect.top),
        })
        return
      }
      const position = canvasApiRef.current?.screenToWorld?.(upEvent.clientX, upEvent.clientY)
      payload.onDrop?.({
        x: Math.round((position?.x ?? 120) - 104),
        y: Math.round((position?.y ?? 80) - 58),
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; label: string } | null>(null)

  // ---------- 左侧库选中 ----------
  const selectLibraryCard = useCallback((kind: LibSelKind, id: string) => {
    if (kind === 'workflow' || kind === 'service') {
      selectWorkflow(id)
      return
    }
    selection.selectLib(kind, id)
    if (kind === 'parentTemplate') {
      // 父代理模板点击：右侧属性栏无显示（§4.5.5）
      selection.selectEditor(null)
      return
    }
    if (kind === 'stage' || kind === 'groupTemplate') {
      selection.selectEditor(null)
      return
    }
    const editorKindMap: Record<string, 'role' | 'file' | 'database'> = { role: 'role', file: 'file', database: 'database' }
    const editorKind = editorKindMap[kind]
    if (editorKind) selection.selectEditor({ source: 'template', kind: editorKind, id })
  }, [selectWorkflow, selection])

  // ---------- 编辑器 patch ----------
  const patchEditor = useCallback((patch: Record<string, unknown>) => {
    const editor = state.editor
    if (!editor) return
    if (editor.source === 'workflow' || editor.source === 'service') {
      dispatch({ type: 'DOC_PATCH', patch: { name: patch.name as string | undefined, description: patch.description as string | undefined } })
      return
    }
    if (editor.source === 'template') {
      const template = state.templates[editor.kind].find((item) => item.id === editor.id)
      if (!template) return
      // 将 name 双写（label/name 兼容：模板数据源字段为 name）
      const normalized = { ...patch }
      delete normalized.label
      dispatch({ type: 'TEMPLATE_UPDATED', kind: editor.kind, template: { ...template, ...normalized } })
      return
    }
    if (editor.source === 'node') {
      const node = state.canvas.nodes.find((item) => item.id === editor.id)
      if (!node) return
      if (node.kind === 'agent' || node.kind === 'parent') {
        const normalized = { ...patch }
        delete normalized.name
        dispatch({ type: 'NODE_DATA_PATCH', id: editor.id, patch: normalized })
      } else {
        dispatch({ type: 'NODE_DATA_PATCH', id: editor.id, patch })
      }
      return
    }
    if (editor.source === 'edge') {
      dispatch({ type: 'EDGE_PATCH', id: editor.id, patch })
    }
  }, [dispatch, state.canvas.nodes, state.editor])

  // ---------- 保存 / 删除编辑器对象 ----------
  const saveEditor = useCallback(async () => {
    const editor = state.editor
    if (!editor) return
    if (editor.source === 'workflow' || editor.source === 'service') {
      await saveCanvas()
      return
    }
    if (editor.source === 'template') {
      const template = state.templates[editor.kind].find((item) => item.id === editor.id)
      if (!template) return
      try {
        await templates.saveTemplate(editor.kind, template)
        notify('success', t.toastSaved)
      } catch (error) {
        toastError(error)
      }
      return
    }
    if (editor.source === 'node' || editor.source === 'edge') {
      await saveCanvas()
      return
    }
  }, [notify, saveCanvas, state.canvas.nodes, state.editor, state.templates, t.toastSaved, templates, toastError])

  const deleteEditor = useCallback(async () => {
    const editor = state.editor
    if (!editor) return
    if (editor.source === 'workflow') {
      const flow = currentFlowOf(state)
      if (!flow) return
      // 本地草稿（未入库）直接移除；已入库工作流走确认框 + 后端删除
      if ((flow as { _draft?: boolean })._draft === true) {
        dispatch({ type: 'WORKFLOW_REMOVED', id: flow.id })
        dispatch({ type: 'CLEAR_CANVAS' })
        dispatch({ type: 'CLEAR_SELECTION' })
        notify('info', t.toastDeleted)
        return
      }
      dispatch({
        type: 'CONFIRM_SET',
        confirm: {
          kind: 'confirmText',
          title: t.deleteFlow,
          message: `${t.confirmDelete}（${flow.name}）`,
          onConfirm: () => {
            void workflows.deleteWorkflow(flow.id).then(() => {
              dispatch({ type: 'CLEAR_CANVAS' })
              notify('info', t.toastDeleted)
            }).catch((error) => {
              toastError(error)
              dispatch({ type: 'CONFIRM_SET', confirm: null })
            })
          },
        },
      })
      return
    }
    if (editor.source === 'service') {
      const service = currentServiceOf(state)
      if (!service) return
      // 本地草稿（未入库）直接移除
      if ((service as { _draft?: boolean })._draft === true) {
        dispatch({ type: 'SERVICE_REMOVED', id: service.id })
        dispatch({ type: 'CLEAR_CANVAS' })
        dispatch({ type: 'CLEAR_SELECTION' })
        notify('info', t.toastDeleted)
        return
      }
      dispatch({
        type: 'CONFIRM_SET',
        confirm: {
          kind: 'confirmText',
          title: t.deleteFlow,
          message: `${t.confirmDelete}（${service.name}）`,
          onConfirm: () => {
            void remote.call(EP.EP_DELETE_SERVICE, { sessionId: state.sessionId, id: service.id }).then(() => {
              dispatch({ type: 'SERVICE_REMOVED', id: service.id })
              dispatch({ type: 'CLEAR_CANVAS' })
              notify('info', t.toastDeleted)
            }).catch((error) => {
              toastError(error)
              dispatch({ type: 'CONFIRM_SET', confirm: null })
            })
          },
        },
      })
      return
    }
    if (editor.source === 'template') {
      const template = state.templates[editor.kind].find((item) => item.id === editor.id)
      if (!template) return
      // 本地草稿（未入库）直接移除；已入库模板走确认框 + 后端删除
      if ((template as { _draft?: boolean })._draft === true) {
        dispatch({ type: 'TEMPLATE_REMOVED', kind: editor.kind, id: editor.id })
        dispatch({ type: 'CLEAR_SELECTION' })
        notify('info', t.toastDeleted)
        return
      }
      dispatch({
        type: 'CONFIRM_SET',
        confirm: {
          kind: 'confirmText',
          title: t.deleteTemplateTitle,
          message: t.deleteTemplateMessage.replace('{name}', String((template as { name?: unknown }).name ?? '')),
          onConfirm: () => {
            void templates.deleteTemplate(editor.kind, editor.id).then(() => {
              dispatch({ type: 'CLEAR_SELECTION' })
              notify('info', t.toastDeleted)
            }).catch((error) => {
              toastError(error)
              dispatch({ type: 'CONFIRM_SET', confirm: null })
            })
          },
        },
      })
      return
    }
    if (editor.source === 'node') {
      removeSelected()
      return
    }
    if (editor.source === 'edge') {
      removeLine(editor.id)
    }
  }, [dispatch, notify, removeLine, removeSelected, state.editor, state.sessionId, state.templates, t.confirmDelete, t.deleteFlow, t.deleteTemplateMessage, t.deleteTemplateTitle, t.toastDeleted, templates, toastError, workflows])

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
  const removeGroupMember = useCallback((memberId: string) => {
    if (!state.selection.nodeId) return
    const group = state.canvas.nodes.find((item) => item.id === state.selection.nodeId)
    if (!group || group.kind !== 'group') return
    history.remember()
    dispatch({
      type: 'NODE_DATA_PATCH',
      id: group.id,
      patch: { memberIds: (group.data.memberIds as string[]).filter((item) => item !== memberId) },
    })
    dispatch({
      type: 'NODE_DATA_PATCH',
      id: memberId,
      patch: { groupId: null },
    })
  }, [dispatch, history, state.canvas.nodes, state.selection.nodeId])

  // ---------- 运行（模式一） ----------
  const startRun = useCallback(async () => {
    if (state.mode !== 'mode1') return
    const flow = currentFlowOf(state)
    if (!flow) return
    const hasStart = state.canvas.nodes.some((node) => node.kind === 'start')
    const hasEnd = state.canvas.nodes.some((node) => node.kind === 'end')
    if (!hasStart || !hasEnd) {
      notify('error', t.needStartAndEnd)
      return
    }
    const saved = await saveCanvas()
    if (!saved) return
    try {
      const runId = await runControl.startRun(state.sessionId, saved.id)
      if (runId) notify('success', t.toastRunning)
    } catch (error) {
      toastError(error)
    }
  }, [notify, runControl, saveCanvas, state.canvas.nodes, state.mode, state.sessionId, t.needStartAndEnd, t.toastRunning, toastError])

  const stopRun = useCallback(async () => {
    if (!state.run.runId) return
    try {
      await runControl.stopRun(state.run.runId)
      notify('info', t.toastStopped)
    } catch (error) {
      toastError(error)
    }
  }, [notify, runControl, state.run.runId, t.toastStopped, toastError])

  // ---------- 运行历史 / 断点恢复 ----------
  const openHistory = useCallback(async () => {
    dispatch({ type: 'HISTORY_OPEN', open: true })
    const flow = currentFlowOf(state)
    if (!flow) return
    try {
      const items = await remote.call(EP.EP_RUN_HISTORY, { flowId: flow.id }) as unknown[]
      dispatch({ type: 'RUN_HISTORY_LOADED', items: Array.isArray(items) ? items as [] : [] })
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, state, remote, toastError])

  const resumeRun = useCallback(async (runId: string) => {
    const flow = currentFlowOf(state)
    if (!flow) return
    try {
      const result = await remote.call(EP.EP_RUN_RESUME, { sessionId: state.sessionId, flowId: flow.id, runId }) as { runId?: unknown }
      const newRunId = String(result?.runId ?? '')
      if (newRunId) dispatch({ type: 'RUN_STARTED', runId: newRunId })
      dispatch({ type: 'HISTORY_OPEN', open: false })
      notify('success', t.toastResuming)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, state, t.toastResuming, toastError])

  // ---------- 模式二服务 ----------
  const serviceRunning = currentService?.status === 'running'

  const startService = useCallback(async () => {
    const service = currentServiceOf(state)
    if (!service) return
    const hasInput = state.canvas.nodes.some((node) => node.kind === 'start')
    const hasOutput = state.canvas.nodes.some((node) => node.kind === 'end')
    const hasParent = state.canvas.nodes.some((node) => node.kind === 'parent')
    if (!hasInput || !hasOutput) {
      notify('error', t.needStartAndEnd)
      return
    }
    if (!hasParent) {
      notify('error', t.needParentForService)
      return
    }
    const saved = await saveCanvas()
    if (!saved) return
    try {
      await serviceControl.startService(service.id)
      notify('success', t.toastServiceStarted)
    } catch (error) {
      toastError(error)
    }
  }, [notify, saveCanvas, serviceControl, state.canvas.nodes, state.mode, t.needParentForService, t.needStartAndEnd, t.toastServiceStarted, toastError])

  const stopService = useCallback(async () => {
    const service = currentServiceOf(state)
    if (!service) return
    try {
      await serviceControl.stopService(service.id)
      notify('info', t.toastServiceStopped)
    } catch (error) {
      toastError(error)
    }
  }, [notify, serviceControl, t.toastServiceStopped, toastError])

  // ---------- 模式切换（未保存守卫；需求 §4.1.1） ----------
  const switchMode = useCallback((mode: 'mode1' | 'mode2') => {
    if (mode === state.mode) return
    guard.guard(() => {
      modeSwitch.setMode(mode)
      dispatch({ type: 'CLEAR_CANVAS' })
      if (mode === 'mode1') {
        void workflows.loadWorkflows()
      } else {
        void serviceControl.loadServices(state.sessionId)
      }
    })
  }, [dispatch, guard, modeSwitch, serviceControl, state.mode, state.sessionId, workflows])

  const [modeMenuOpen, setModeMenuOpen] = useState(false)

  // ---------- 关闭守卫（§4.5.9：关闭工作台前未保存修改需确认） ----------
  const requestClose = useCallback(() => {
    if (!onClose) return
    guard.guard(() => onClose())
  }, [guard, onClose])

  // ---------- 导入导出 ----------
  const exportCurrent = useCallback(async () => {
    if (editorData?.kind === 'workflow' || editorData?.kind === 'service') {
      const flow = currentFlowOf(state) ?? currentServiceOf(state)
      if (!flow) return
      try {
        const result = await remote.call(EP.EP_EXPORT_WORKFLOW, { sessionId: state.sessionId, id: flow.id }) as { json?: string }
        const name = String(flow.name ?? t.exportFileName).replace(/[\\/:*?"<>|]/g, '_')
        download(String(result?.json ?? ''), `${name}.json`)
        notify('success', t.toastExported)
      } catch (error) {
        toastError(error)
      }
      return
    }
    if (editorData?.kind === 'role' && editorData.template) {
      try {
        const result = await remote.call(EP.EP_EXPORT_AGENT_TEMPLATE, { id: String(editorData.templateId ?? '') }) as { json?: string }
        const name = String(editorData.name ?? 'agent').replace(/[\\/:*?"<>|]/g, '_')
        download(String(result?.json ?? ''), `${name}.agent.json`)
        notify('success', t.toastExported)
      } catch (error) {
        toastError(error)
      }
      return
    }
    notify('error', t.exportEmpty)
  }, [editorData, currentFlowOf, notify, remote, state.sessionId, t.exportEmpty, t.exportFileName, t.toastExported, toastError])

  const handleImportFile = useCallback(async (file: File | null) => {
    if (!file) return
    try {
      const json = await readFileAsText(file)
      if (isRoleTemplateBundle(json)) {
        const result = await remote.call(EP.EP_IMPORT_AGENT_TEMPLATE, { json }) as { conflict?: boolean; existingName?: string; template?: unknown }
        if (result?.conflict) {
          dispatch({
            type: 'CONFIRM_SET',
            confirm: {
              kind: 'importConflict',
              kind2: 'agent',
              json,
              name: String(result.existingName ?? ''),
              message: t.importConflictMessage.replace('{name}', String(result.existingName ?? '')),
            },
          })
          return
        }
        await templates.loadTemplates()
        notify('success', t.toastImported)
        return
      }
      const result = await remote.call(EP.EP_IMPORT_WORKFLOW, { sessionId: state.sessionId, json }) as { conflict?: boolean; existingName?: string; workflow?: unknown }
      if (result?.conflict) {
        dispatch({
          type: 'CONFIRM_SET',
          confirm: {
            kind: 'importConflict',
            kind2: 'workflow',
            json,
            name: String(result.existingName ?? ''),
            message: t.importConflictMessage.replace('{name}', String(result.existingName ?? '')),
          },
        })
        return
      }
      // 导入的 bundle 可能带 mode2（服务）：工作流与服务列表都刷新
      await Promise.all([workflows.loadWorkflows(), serviceControl.loadServices(state.sessionId)])
      notify('success', t.toastImported)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, remote, serviceControl, state.sessionId, t.importConflictMessage, t.toastImported, templates, toastError, workflows])

  const resolveImportConflict = useCallback(async (mode: 'rename' | 'overwrite') => {
    const confirm = state.confirm
    dispatch({ type: 'CONFIRM_SET', confirm: null })
    if (confirm?.kind !== 'importConflict') return
    const json = confirm.json as string
    try {
      if (confirm.kind2 === 'agent') {
        await remote.call(EP.EP_IMPORT_AGENT_TEMPLATE, { json, conflictMode: mode })
        await templates.loadTemplates()
      } else {
        await remote.call(EP.EP_IMPORT_WORKFLOW, { sessionId: state.sessionId, json, conflictMode: mode })
        await workflows.loadWorkflows()
      }
      notify('success', t.toastImported)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, remote, state.confirm, state.sessionId, t.toastImported, templates, toastError, workflows])

  // ---------- 文件选择（文件模板/节点：文本直接读；非文本读 base64 交后端受管拷贝） ----------
  /** 角色系统提示词 .md 加载（§4.2.3.1 卡片设计）。 */
  const loadPersonaMd = useCallback(async () => {
    personaInputRef.current?.click()
  }, [])

  const onPersonaMdSelected = useCallback(async (file: File | null) => {
    if (!file) return
    try {
      const content = await readFileAsText(file)
      patchEditor({ systemPrompt: content })
      notify('success', t.toastSaved)
    } catch (error) {
      toastError(error)
    }
  }, [notify, patchEditor, t.toastSaved, toastError])

  /** 协作 Prompt 从 .md 加载（与角色 System Prompt 同路径）。 */
  const loadGroupMd = useCallback(() => {
    groupMdInputRef.current?.click()
  }, [])

  const onGroupMdSelected = useCallback(async (file: File | null) => {
    if (!file) return
    try {
      const content = await readFileAsText(file)
      patchEditor({ collabPrompt: content })
      notify('success', t.toastSaved)
    } catch (error) {
      toastError(error)
    }
  }, [notify, patchEditor, t.toastSaved, toastError])

  const onFileSelect = useCallback(async (file: File) => {
    const editor = state.editor
    if (!editor) return
    // 目标：模板或画布节点（文件 kind）
    const isTemplate = editor.source === 'template'
    const isNode = editor.source === 'node'
    if (!isTemplate && !isNode) return
    try {
      const fileKind = (editor.source === 'template'
        ? (state.templates[editor.kind as 'file'] ?? []).find((item) => item.id === editor.id)
        : state.canvas.nodes.find((item) => item.id === editor.id)?.data) as { fileKind?: string } | undefined
      const kind = String(fileKind?.fileKind ?? 'text')
      if (kind === 'text') {
        const content = await readFileAsText(file)
        patchEditor({ content, fileName: file.name })
      } else {
        const base64 = await readFileAsBase64(file)
        const result = await remote.call(EP.EP_FILE_UPLOAD, { name: file.name, base64 }) as { managedPath?: string; fileName?: string }
        patchEditor({ managedPath: result?.managedPath, fileName: result?.fileName ?? file.name })
      }
      notify('success', t.toastSaved)
    } catch (error) {
      toastError(error)
    }
  }, [notify, patchEditor, remote, state.canvas.nodes, state.editor, state.templates, t.toastSaved, toastError])

  // ---------- 数据库测试连接 ----------
  const testDbConnection = useCallback(async () => {
    const editor = state.editor
    if (editor?.source !== 'node') return
    const node = state.canvas.nodes.find((item) => item.id === editor.id)
    if (!node || node.kind !== 'database') return
    try {
      await remote.call(EP.EP_DB_TEST, { node })
      notify('success', copyDbSuccess(t))
    } catch (error) {
      notify('error', String((error as Error)?.message ?? error))
    }
  }, [notify, remote, state.canvas.nodes, state.editor])

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (state.confirm) dispatch({ type: 'CONFIRM_SET', confirm: null })
        else selection.clearSelection()
        return
      }
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      if (typing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selection.edgeId) {
          event.preventDefault()
          removeLine(state.selection.edgeId)
        } else if (state.selection.nodeId) {
          event.preventDefault()
          removeSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch, history, removeLine, removeSelected, selection, state.confirm, state.selection])

  // ---------- 派生 ----------
  const stageKinds = useMemo(() => stageTemplateKinds(state.mode), [state.mode])
  const parentTemplate = useMemo(() => (state.templates.role as import('../../host/shared/types.js').RoleTemplate[]).find((item) => item.kind === 'parent') ?? null, [state.templates.role])
  const roleTemplates = useMemo(() => (state.templates.role as import('../../host/shared/types.js').RoleTemplate[]).filter((item) => item.kind !== 'parent'), [state.templates.role])
  const edgeList = useMemo(() => flowToCanvasLines(state.canvas.edges), [state.canvas.edges])
  const highlightedNodeIds = useMemo(() => {
    const lib = state.selection.lib
    if (!lib || lib.kind !== 'role' && lib.kind !== 'file' && lib.kind !== 'database') return []
    const kindMap: Record<string, string> = { role: 'agent', file: 'file', database: 'database' }
    return []
  }, [state.selection.lib])

  const toolbarRunning = state.mode === 'mode2' ? currentService?.status === 'running' : running

  // ---------- 渲染 ----------
  return (
    <div className="wf-root" data-wf-immersive="true">
      {/* 标题顶栏 = 窗口标题栏（工作流设计器一行；可拖动；组合按钮右侧为关闭按钮） */}
      <nav className="wf-tabs" data-wf-titlebar="" onPointerDown={onTitlebarDrag}>
        <span className="wf-titlebar__title">{t.studio}</span>
        <span className="wf-titlebar__badge">{t.badge}</span>
        <span className="wf-titlebar__note">{t.note}</span>
        <span className="wf-titlebar__spacer" />
        <input
          ref={libraryImportRef}
          type="file"
          accept=".json,application/json"
          className="wf-import-hidden"
          onChange={(event) => { void handleImportFile(event.target.files?.[0] ?? null); event.target.value = '' }}
        />
        <input
          ref={personaInputRef}
          type="file"
          accept=".md,.markdown"
          className="wf-import-hidden"
          onChange={(event) => { void onPersonaMdSelected(event.target.files?.[0] ?? null); event.target.value = '' }}
        />
        <input
          ref={groupMdInputRef}
          type="file"
          accept=".md,.markdown"
          className="wf-import-hidden"
          onChange={(event) => { void onGroupMdSelected(event.target.files?.[0] ?? null); event.target.value = '' }}
        />
        <button type="button" className="wf-btn is-ghost" onClick={() => libraryImportRef.current?.click()}>{t.importWorkflow}</button>
        <button type="button" className="wf-btn is-ghost" onClick={() => { void exportCurrent() }}>{t.exportWorkflow}</button>
        <div className="wf-titlebar__mode">
          <button type="button" className="wf-btn" onClick={() => setModeMenuOpen((open) => !open)}>
            {state.mode === 'mode2' ? t.mode2 : t.mode1}
            <span className="wf-titlebar__caret">▾</span>
          </button>
          {modeMenuOpen
            ? (
                <div className="wf-mode-menu">
                  <button type="button" className="wf-mode-menu__item" onClick={() => { setModeMenuOpen(false); switchMode('mode1') }}>{t.mode1}</button>
                  <button type="button" className="wf-mode-menu__item" onClick={() => { setModeMenuOpen(false); switchMode('mode2') }}>{t.mode2}</button>
                </div>
              )
            : null}
        </div>
        <button type="button" className="wf-btn" title={t.combos} onClick={() => dispatch({ type: 'COMBO_OPEN', open: true })}>{t.combos}</button>
        {onClose
          ? <button type="button" className="wf-btn wf-iconbtn wf-titlebar__close" title={t.windowClose} aria-label={t.windowClose} onClick={requestClose}>✕</button>
          : null}
      </nav>

      <main className="wf-main" data-wf-main="">
        <LeftPanel
          copy={t}
          libTab={state.libTab}
          onSetTab={(tab) => dispatch({ type: 'SET_LIB_TAB', tab })}
          open={state.panels.leftOpen}
          width={state.panels.leftWidth}
          mode={state.mode}
          workflows={state.mode === 'mode2' ? state.services : state.workflows}
          parentTemplate={parentTemplate}
          roleTemplates={roleTemplates}
          fileTemplates={state.templates.file as import('../../host/shared/types.js').FileTemplate[]}
          databaseTemplates={state.templates.database as import('../../host/shared/types.js').DatabaseTemplate[]}
          stageKinds={stageKinds}
          libSelection={state.selection.lib}
          modeName={modeName}
          onSelectWorkflow={selectWorkflow}
          onSelectLib={selectLibraryCard}
          onPlaceTemplate={placeTemplateNode}
          onPlaceTemplateIntoGroup={placeTemplateIntoGroup}
          onPlaceStage={placeStageNode}
          onPlaceGroup={placeGroupNode}
          onPlaceParent={placeParentNode}
          onCreateNew={createNew}
          onBeginDrag={beginLibraryDrag}
        />

        <div
          className="wf-splitter"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(event) => panels.beginResize('left', event)}
        />

        <div className="wf-canvas-shell" ref={canvasShellRef}>
          <Toolbar
            copy={t}
            mode={state.mode}
            onUndo={history.undo}
            onRedo={history.redo}
            onClear={clearGraph}
            canClear={state.canvas.nodes.length > 0}
            onTidy={tidyGraph}
            canTidy={state.canvas.nodes.length > 0}
            onSave={() => { void saveCanvas() }}
            canSave={Boolean(state.currentId)}
            running={toolbarRunning}
            onStop={() => { void (state.mode === 'mode2' ? stopService() : stopRun()) }}
            onRun={() => { void (state.mode === 'mode2' ? startService() : startRun()) }}
            onOpenHistory={() => { void openHistory() }}
            canHistory={state.mode === 'mode1' && Boolean(currentFlow)}
            serviceStatus={state.mode === 'mode2' ? { port: currentService?.port, status: currentService?.status } : null}
          />
          {state.mode === 'mode2'
            ? <ServiceConsole
                copy={t}
                service={currentService}
                sessionId={state.sessionId}
                busy={state.run.runId !== null}
              />
            : null}
          <GraphCanvas
            nodes={state.canvas.nodes}
            edges={edgeList}
            copy={{ ...t, modeName }}
            mode={state.mode}
            selectedNode={state.selection.nodeId}
            selectedEdge={state.selection.edgeId}
            runStatusByNode={runStatusByNode}
            highlightedNodeIds={highlightedNodeIds}
            onInit={(api) => { canvasApiRef.current = api }}
            onNodeDragStart={onNodeDragStart}
            onNodeMove={moveNode}
            onNodeDropToGroup={addNodeToGroup}
            onNodeSelect={(id) => selection.selectNode(id)}
            onEdgeSelect={(id) => selection.selectEdge(id)}
            onPaneClick={() => selection.clearSelection()}
            onConnect={onConnect}
            onConnectionRejected={onConnectionRejected}
            onGroupResize={onGroupResize}
            fitLabel={t.fitView}
            zoomInLabel={t.zoomIn}
            zoomOutLabel={t.zoomOut}
            emptyHint={t.emptyHint}
          />
        </div>

        <div
          className="wf-splitter"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(event) => panels.beginResize('right', event)}
        />

        <Inspector
          copy={t}
          open={state.panels.rightOpen}
          width={state.panels.rightWidth}
          editorData={editorData}
          presets={state.presets as Array<{ id: string; name?: string }>}
          tools={state.tools}
          models={state.models as Array<{ provider: string; model: string; efforts?: Array<{ id: string; name: string }> }>}
          combos={state.combos as Array<{ id: string; name: string; tools?: string[]; mcpServers?: string[] }>}
          flowMeta={{ nodeCount: state.canvas.nodes.length, revision: Number((currentFlow ?? currentService)?.revision ?? 0) }}
          onPatch={patchEditor}
          onDelete={() => { void deleteEditor() }}
          onSave={() => { void saveEditor() }}
          onCopyProxy={copyToProxy}
          onRemoveMember={removeGroupMember}
          onFileSelect={(file) => { void onFileSelect(file) }}
          onLoadMd={() => { void loadPersonaMd() }}
          onLoadGroupMd={() => { void loadGroupMd() }}
          onTestDb={() => { void testDbConnection() }}
          saveDisabled={toolbarRunning}
          importBusy={false}
        />
      </main>

      {state.message ? <div className="wf-message">{state.message}</div> : null}

      <ConfirmDialog
        confirm={state.confirm}
        copy={t}
        onClose={() => dispatch({ type: 'CONFIRM_SET', confirm: null })}
        onSaveAndProceed={() => { void guard.saveAndProceed(() => saveCanvas()) }}
        onDiscardAndProceed={guard.discardAndProceed}
        onResolveImport={(mode) => { void resolveImportConflict(mode as 'rename' | 'overwrite') }}
      />

      {state.historyOpen
        ? <RunHistory
            history={state.runHistory}
            selectedRunId={state.selectedRunId}
            copy={t}
            onSelect={(id) => dispatch({ type: 'RUN_HISTORY_SELECT', id })}
            onClose={() => dispatch({ type: 'HISTORY_OPEN', open: false })}
            onResume={(runId) => { void resumeRun(runId) }}
            canResume={state.mode === 'mode1'}
          />
        : null}

      {state.comboOpen
        ? <ComboManager
            copy={t}
            remote={remote}
            sessionId={state.sessionId}
            onClose={() => dispatch({ type: 'COMBO_OPEN', open: false })}
            onToast={(kind, text) => toast(kind, text)}
            onChanged={() => { void remote.call(EP.EP_TOOL_COMBOS).then((items) => dispatch({ type: 'COMBOS_LOADED', items: Array.isArray(items) ? items : [] })).catch(() => {}) }}
          />
        : null}

      {dragPreview
        ? <div className="wf-drag-preview" style={{ left: dragPreview.x + 12, top: dragPreview.y + 14 }}>{dragPreview.label}</div>
        : null}

      <div className="wf-toast-host">
        {state.toasts.map((item) => (
          <div key={item.id} className={`wf-toast is-${item.kind}`}>
            <span className="wf-toast__dot" />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

/** 角色节点 patch 消毒：proxySourceId/groupId 由系统维护。 */
function sanitizeRolePatch(patch: Record<string, unknown>, node: CanvasNode): Record<string, unknown> {
  const clean = { ...patch }
  delete clean.proxySourceId
  delete clean.kind
  if (clean.groupId === undefined && node.kind === 'parent') clean.groupId = null
  return clean
}

function flowLayout(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  // 简化布局（旧项目 layoutNodes 算法在 lib/graph-model.ts；此处用带位置缺省的直方布局）
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    if (edge.sourceHandle !== 'flow-out') continue
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  }
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id)
  const level = new Map(queue.map((id) => [id, 0]))
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1))
      indegree.set(next, (indegree.get(next) ?? 0) - 1)
      if ((indegree.get(next) ?? 0) === 0) queue.push(next)
    }
  }
  nodes.forEach((node) => {
    if (!level.has(node.id)) {
      const maxLevel = order.length > 0 ? Math.max(...level.values()) : -1
      level.set(node.id, maxLevel + 1)
    }
  })
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const column = level.get(node.id) ?? 0
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return { ...node, position: { x: 70 + column * 270, y: 80 + row * 180 } }
  })
}

function copyDbSuccess(t: Dict): string {
  return t.dbTestSuccess
}
