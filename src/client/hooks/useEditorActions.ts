// src/client/hooks/useEditorActions.ts
//
// 编辑器/选择操作面：左侧库卡片选中、编辑器字段 patch、保存编辑器对象，
// 以及删除编辑器对象（草稿直删 / 已入库走确认框 + 后端删除 / 节点连线级联）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { LibSelKind, StudioAction, StudioState } from '../studio/studio-state.js'
import { currentFlowOf, currentServiceOf } from '../studio/studio-state.js'
import type { WorkflowsFace } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { SelectionFace } from './useSelection.js'
import type { RemoteFace } from './useRemote.js'
import type { ToastFace } from './useToast.js'
import type { DocumentActionsFace } from './useDocumentActions.js'
import type { CanvasActionsFace } from './useCanvasActions.js'
import type { RunLockSet } from '../lib/run-locks.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

export interface EditorActionsFace {
  selectLibraryCard(kind: LibSelKind, id: string): void
  patchEditor(patch: Record<string, unknown>): void
  saveEditor(): Promise<void>
  deleteEditor(): Promise<void>
}

/** 编辑器面外部依赖（运行中画布锁定判定）。 */
export interface EditorActionsOptions {
  /** 运行中锁定集：被锁连线的字段编辑直接忽略（防「运行前已选中」的旁路改写）。 */
  locks: RunLockSet
}

/** 编辑器面（保存/删除失败 toast；节点/连线删除复用画布面）。 */
export function useEditorActions(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  workflows: WorkflowsFace,
  flowTemplates: FlowTemplatesFace,
  templates: TemplatesFace,
  selection: SelectionFace,
  remote: RemoteFace,
  saveCanvas: DocumentActionsFace['saveCanvas'],
  removeSelected: CanvasActionsFace['removeSelected'],
  removeLine: CanvasActionsFace['removeLine'],
  selectWorkflow: DocumentActionsFace['selectWorkflow'],
  selectFlowTemplate: DocumentActionsFace['selectFlowTemplate'],
  options: EditorActionsOptions,
): EditorActionsFace {
  const { locks } = options
  // ---------- 左侧库选中 ----------
  // 打开工作流/服务/模板（selectWorkflow/selectFlowTemplate 由文档面注入，未保存守卫在后端）
  const selectLibraryCard = useCallback((kind: LibSelKind, id: string) => {
    if (kind === 'workflow' || kind === 'service') {
      selectWorkflow(id)
      return
    }
    if (kind === 'workflowTemplate') {
      selectFlowTemplate(id)
      return
    }
    selection.selectLib(kind, id)
    if (kind === 'parentTemplate') {
      // 父代理模板点击：具备属性（属性栏显示模板内容），应展开右侧属性栏。
      // 注意：此前逻辑为 selectEditor(null)（不弹）——经用户裁决修正（具备属性的才弹，
      // 只有阶段节点/侧栏阶段卡片不弹），此处按 role 模板一样设置编辑器引用。
      selection.selectEditor({ source: 'template', kind: 'role', id })
      return
    }
    if (kind === 'stage') {
      selection.selectEditor(null)
      return
    }
    if (kind === 'groupTemplate') {
      // 协作组模板点击：右侧属性栏显示模板内容（名称/协作 Prompt），可保存/删除（用户批注）
      selection.selectEditor({ source: 'template', kind: 'group', id })
      return
    }
    const editorKindMap: Record<string, 'role' | 'file' | 'database'> = { role: 'role', file: 'file', database: 'database' }
    const editorKind = editorKindMap[kind]
    if (editorKind) selection.selectEditor({ source: 'template', kind: editorKind, id })
  }, [selectWorkflow, selectFlowTemplate, selection])

  // ---------- 编辑器 patch ----------
  const patchEditor = useCallback((patch: Record<string, unknown>) => {
    const editor = state.editor
    if (!editor) return
    if (editor.source === 'workflow' || editor.source === 'service' || editor.source === 'flowTemplate') {
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
      // 画布节点的名称数据源为 label（模板才使用 name）；双写补丁在此消毒，
      // 避免 file 节点 data 里残留多余的 name 字段（用户验收：磁盘数据被污染）
      const normalized = { ...patch }
      delete normalized.name
      dispatch({ type: 'NODE_DATA_PATCH', id: editor.id, patch: normalized })
      return
    }
    if (editor.source === 'edge') {
      // 运行中锁定：被锁连线（已完成流程 / 执行中节点左入口）的字段编辑直接忽略
      // ——正常路径下点击被锁连线不会选中，此处防「运行开始前已选中」的旁路改写。
      if (locks.isEdgeLocked(editor.id)) return
      dispatch({ type: 'EDGE_PATCH', id: editor.id, patch })
    }
  }, [dispatch, locks, state.canvas.nodes, state.editor, state.templates])

  // ---------- 保存 / 删除编辑器对象 ----------
  const saveEditor = useCallback(async () => {
    const editor = state.editor
    if (!editor) return
    if (editor.source === 'workflow' || editor.source === 'service') {
      await saveCanvas()
      return
    }
    if (editor.source === 'flowTemplate') {
      // 模板态：属性栏「保存」= 保存模板全部内容（与画布上方「创建实例」职责二分）
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
            void workflows.deleteWorkflow(flow).then(() => {
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
            // 工作台全局化：删除归属校验用实例绑定的会话（可能不是当前主会话）
            void remote.call(EP.EP_DELETE_SERVICE, { sessionId: service.sessionId, id: service.id }).then(() => {
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
    if (editor.source === 'flowTemplate') {
      const template = state.flowTemplates.find((item) => item.id === editor.id)
      if (!template) return
      // 草稿（未入库）本地直接移除；已入库模板删除**不再二次确认**（用户裁决 2026-02）：
      // 直接走后端删除（成功由 deleteFlowTemplate 内部摘除列表项）并清空画布
      if ((template as { _draft?: boolean })._draft === true) {
        dispatch({ type: 'FLOW_TEMPLATE_REMOVED', id: template.id })
        dispatch({ type: 'CLEAR_CANVAS' })
        dispatch({ type: 'CLEAR_SELECTION' })
        notify('info', t.toastDeleted)
        return
      }
      void flowTemplates.deleteFlowTemplate(template.id).then(() => {
        dispatch({ type: 'CLEAR_CANVAS' })
        notify('info', t.toastDeleted)
      }).catch((error) => {
        // 删除失败不改动本地列表（与后端保持一致），仅提示
        toastError(error)
      })
      return
    }
    if (editor.source === 'template') {
      const template = state.templates[editor.kind].find((item) => item.id === editor.id)
      if (!template) return
      // 草稿（未入库）本地直接移除；已入库模板删除**不再二次确认**（用户裁决 2026-02）
      if ((template as { _draft?: boolean })._draft === true) {
        dispatch({ type: 'TEMPLATE_REMOVED', kind: editor.kind, id: editor.id })
        dispatch({ type: 'CLEAR_SELECTION' })
        notify('info', t.toastDeleted)
        return
      }
      void templates.deleteTemplate(editor.kind, editor.id).then(() => {
        notify('info', t.toastDeleted)
      }).catch((error) => {
        toastError(error)
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
  }, [dispatch, notify, removeLine, removeSelected, state.editor, state.sessionId, state.templates, state.flowTemplates, t.confirmDelete, t.deleteFlow, t.toastDeleted, templates, flowTemplates, toastError, workflows])

  return { selectLibraryCard, patchEditor, saveEditor, deleteEditor }
}
