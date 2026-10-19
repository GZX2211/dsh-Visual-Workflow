// src/client/hooks/useStudioTransfer.ts
//
// 导入导出与任务/数据库交互面：工作流/角色模板导入导出（含命名冲突确认）、
// 系统 Prompt / 协作 Prompt 从 .md 加载、任务描述追加文件路径（不上传）、
// 数据库测试连接。
//
// 任务路径的解析器由宿主接入层注入（桌面端走官方 __DSH_HOST_PATHS__.pathFor）；
// 本 hook 只消费注入面，缺省回退旧 File.path / 文件名。

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
import { remoteErrorMessageOf } from '../lib/remote-error.js'
import { readFileAsText, download } from '../lib/files.js'
import { isRoleTemplateBundle } from '../lib/bundle.js'
import { legacyFilePathOf } from '../sidebar/host-paths.js'

export interface StudioTransferFace {
  exportCurrent(): Promise<void>
  handleImportFile(file: File | null): Promise<void>
  resolveImportConflict(mode: 'rename' | 'overwrite'): Promise<void>
  loadPersonaMd(): void
  onPersonaMdSelected(file: File | null): Promise<void>
  loadGroupMd(): void
  onGroupMdSelected(file: File | null): Promise<void>
  /** 任务描述追加文件路径（只写路径文本，不读取/上传文件内容）。 */
  pickFiles(picked: File[]): void
  testDbConnection(): Promise<void>
}

/** 导入导出与任务/数据库交互面（远端失败抛错，由调用方 toast）。 */
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
  /**
   * 宿主接入层注入的文件路径解析器（桌面端走官方 __DSH_HOST_PATHS__.pathFor）。
   * 缺省回退旧 File.path / 文件名：浏览器安全模型下拿不到本地绝对路径。
   */
  resolveFilePath?: (file: File) => string,
): StudioTransferFace {
  // ---------- 导入导出 ----------
  const exportCurrent = useCallback(async () => {
    if (editorData?.kind === 'workflow' || editorData?.kind === 'service') {
      const flow = currentFlowOf(state) ?? currentServiceOf(state)
      if (!flow) return
      try {
        // 工作台全局化：导出归属校验用实例绑定的会话（可能不是当前主会话）
        const result = await remote.call(EP.EP_EXPORT_WORKFLOW, { sessionId: flow.sessionId, id: flow.id }) as { json?: string }
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
  }, [editorData, currentFlowOf, notify, remote, t.exportEmpty, t.exportFileName, t.toastExported, toastError])

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
      // 导入一律落为「工作流模板」（全局共享，跨会话可见），
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

  // ---------- 任务描述追加文件路径（不上传） ----------
  /** 角色系统提示词 .md 加载（卡片设计）。 */
  const loadPersonaMd = useCallback(async () => {
    personaInputRef.current?.click()
  }, [])

  const onPersonaMdSelected = useCallback(async (file: File | null) => {
    if (!file) return
    try {
      const content = await readFileAsText(file)
      // 记录来源文件名：左侧栏角色模板卡/画布角色卡展示 System Prompt 字段
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

  // 任务描述追加文件路径：只写路径文本，不读取/上传文件内容。
  // 路径来源优先注入的官方桌面桥（浏览器安全模型下拿不到本地绝对路径时回退文件名）。
  const pickFiles = useCallback((picked: File[]) => {
    if (picked.length === 0) return
    const resolvePath = resolveFilePath ?? legacyFilePathOf
    const paths = picked.map(resolvePath).filter((path) => path !== '')
    if (paths.length === 0) return
    const current = String(editorData?.data?.content ?? '')
    const base = current.trimEnd()
    const next = base ? `${base}\n${paths.join('\n')}` : paths.join('\n')
    patchEditor({ content: next })
    notify('success', t.toastSaved)
  }, [editorData, notify, patchEditor, resolveFilePath, t.toastSaved])

  // ---------- 数据库测试连接 ----------
  const testDbConnection = useCallback(async () => {
    const editor = state.editor
    if (editor?.source !== 'node') return
    const node = state.canvas.nodes.find((item) => item.id === editor.id)
    if (!node || node.kind !== 'database') return
    try {
      await remote.call(EP.EP_DB_TEST, { node })
      notify('success', t.dbTestSuccess)
    } catch (error) {
      notify('error', remoteErrorMessageOf(error))
    }
  }, [notify, remote, state.canvas.nodes, state.editor, t.dbTestSuccess])

  return {
    exportCurrent, handleImportFile, resolveImportConflict,
    loadPersonaMd, onPersonaMdSelected, loadGroupMd, onGroupMdSelected,
    pickFiles, testDbConnection,
  }
}


