// src/client/hooks/useStudioTransfer.ts
//
// 导入导出与文件/数据库交互面：工作流/角色模板导入导出（含命名冲突确认）、
// 系统 Prompt / 协作 Prompt 从 .md 加载、文件模板内容选择（文本直读 / 多选
// 上传受管拷贝）、数据库测试连接。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { EditorData, StudioAction, StudioState } from '../studio/studio-state.js'
import { currentFlowOf, currentServiceOf } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import type { WorkflowsFace } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { ToastFace } from './useToast.js'
import type { EditorActionsFace } from './useEditorActions.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'
import { readFileAsText, readFileAsBase64, download } from '../lib/files.js'
import { isRoleTemplateBundle } from '../lib/bundle.js'

export interface StudioTransferFace {
  exportCurrent(): Promise<void>
  handleImportFile(file: File | null): Promise<void>
  resolveImportConflict(mode: 'rename' | 'overwrite'): Promise<void>
  loadPersonaMd(): void
  onPersonaMdSelected(file: File | null): Promise<void>
  loadGroupMd(): void
  onGroupMdSelected(file: File | null): Promise<void>
  onFileSelect(picked: File[]): Promise<void>
  testDbConnection(): Promise<void>
}

/** 导入导出与文件/数据库交互面（远端失败抛错，由调用方 toast）。 */
export function useStudioTransfer(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  remote: RemoteFace,
  templates: TemplatesFace,
  flowTemplates: FlowTemplatesFace,
  workflows: WorkflowsFace,
  patchEditor: EditorActionsFace['patchEditor'],
  editorData: EditorData | null,
  personaInputRef: React.RefObject<HTMLInputElement | null>,
  groupMdInputRef: React.RefObject<HTMLInputElement | null>,
): StudioTransferFace {
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
      const result = await remote.call(EP.EP_IMPORT_WORKFLOW, { json }) as { conflict?: boolean; existingName?: string; template?: unknown }
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
      // 图2 交互改造：导入一律落为「工作流模板」（全局共享，跨会话可见），
      // 用户需在画布中「创建实例」后才能运行——故只刷新模板列表，不动实例列表。
      await flowTemplates.loadFlowTemplates()
      notify('success', t.toastImported)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, remote, t.importConflictMessage, t.toastImported, templates, flowTemplates, toastError, workflows])

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
        await remote.call(EP.EP_IMPORT_WORKFLOW, { json, conflictMode: mode })
        await flowTemplates.loadFlowTemplates()
      }
      notify('success', t.toastImported)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, notify, remote, state.confirm, t.toastImported, templates, flowTemplates, toastError])

  // ---------- 文件选择（文件模板/节点：文本直接读；非文本读 base64 交后端受管拷贝） ----------
  /** 角色系统提示词 .md 加载（§4.2.3.1 卡片设计）。 */
  const loadPersonaMd = useCallback(async () => {
    personaInputRef.current?.click()
  }, [])

  const onPersonaMdSelected = useCallback(async (file: File | null) => {
    if (!file) return
    try {
      const content = await readFileAsText(file)
      // 记录来源文件名：左侧栏角色模板卡/画布角色卡展示 System Prompt 字段（用户验收标注）
      patchEditor({ systemPrompt: content, systemPromptSource: file.name })
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

  const onFileSelect = useCallback(async (picked: File[]) => {
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
        // 文本类型：仅取第一个文件内容（多选仅对非文本文件生效，用户验收：可多选所有类型）
        const { file } = { file: picked[0] }
        const content = await readFileAsText(file)
        patchEditor({ content, fileName: file.name, files: [] })
      } else {
        // 文件类型：多选全部文件 → 逐个上传受管拷贝，累积 files 列表（支持多选所有类型文件）
        const uploaded = []
        for (const file of picked) {
          const base64 = await readFileAsBase64(file)
          const result = await remote.call(EP.EP_FILE_UPLOAD, { name: file.name, base64 }) as { managedPath?: string; fileName?: string }
          uploaded.push({ fileName: result?.fileName ?? file.name, managedPath: result?.managedPath ?? '' })
        }
        const currentFiles = (() => {
          const data = (editor.source === 'template'
            ? (state.templates[editor.kind as 'file'] ?? []).find((item) => item.id === editor.id)
            : state.canvas.nodes.find((item) => item.id === editor.id)?.data) as { files?: Array<{ fileName: string; managedPath: string }> } | undefined
          return Array.isArray(data?.files) ? data.files : []
        })()
        patchEditor({ files: [...currentFiles, ...uploaded] })
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

  return {
    exportCurrent, handleImportFile, resolveImportConflict,
    loadPersonaMd, onPersonaMdSelected, loadGroupMd, onGroupMdSelected,
    onFileSelect, testDbConnection,
  }
}

/** 数据库测试成功提示文案。 */
function copyDbSuccess(t: Dict): string {
  return t.dbTestSuccess
}
