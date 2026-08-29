// src/client/hooks/useDocumentActions.ts
//
// 文档生命周期操作：保存画布（实例/模板/服务）、模板创建实例、实例另存为
// 模板、打开/选中（未保存守卫包裹）与新建草稿。数据经各列表面 hook 落库，
// 本面只负责编排与 toast 反馈。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import { currentFlowOf, currentFlowTemplateOf, currentServiceOf, type LibTab, type StudioAction, type StudioState } from '../studio/studio-state.js'
import type { WorkflowsFace } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { SelectionFace } from './useSelection.js'
import type { UnsavedGuardFace } from './useUnsavedGuard.js'
import type { ServiceControlFace } from './useServiceControl.js'
import type { ToastFace } from './useToast.js'
import type { Dict } from '../i18n.js'

export interface DocumentActionsFace {
  /** 保存当前画布（实例/模板/服务；成功记录已保存快照并 toast）。返回保存成功的文档（类型为三态并集，与原实现推断一致）。 */
  saveCanvas(): Promise<WorkflowDocument | WorkflowTemplate | ServiceState | null>
  /** 创建实例（模板态：模板内容存为新实例并切到实例态；实例态等价保存）。 */
  createInstanceFromCanvas(): Promise<WorkflowDocument | null>
  /** 实例 → 模板（另存为全局共享工作流模板）。 */
  saveCurrentAsFlowTemplate(): Promise<void>
  openFlowById(id: string): void
  openServiceById(id: string): void
  openFlowTemplateById(id: string): void
  /** 打开工作流/服务（未保存守卫后切换；按 mode 分流）。 */
  selectWorkflow(id: string): void
  /** 打开工作流模板（未保存守卫后切换）。 */
  selectFlowTemplate(id: string): void
  /** 新建（工作流 Tab / 角色 / 数据分区 / 协作组分区；+ 号新建模板）。 */
  createNew(tab: LibTab, section?: 'file' | 'database' | 'flowTemplate' | 'group'): void
}

/** 文档生命周期面（保存失败抛错/提示由保存路径处理）。 */
export function useDocumentActions(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  guard: UnsavedGuardFace,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  workflows: WorkflowsFace,
  flowTemplates: FlowTemplatesFace,
  templates: TemplatesFace,
  selection: SelectionFace,
  serviceControl: ServiceControlFace,
  t: Dict,
): DocumentActionsFace {
  // ---------- 保存 / 打开 ----------
  const saveCanvas = useCallback(async () => {
    if (state.currentKind === 'workflow') {
      const flow = currentFlowOf(state)
      if (!flow) return null
      try {
        const saved = await workflows.saveWorkflow(flow, state.canvas.nodes, state.canvas.edges)
        if (saved) {
          // MARK_SAVED：同时记录「已保存图快照」，供撤销/重做精确判定 dirty（Bug 17）
          dispatch({ type: 'MARK_SAVED' })
          notify('success', t.toastSaved)
        }
        return saved
      } catch (error) {
        toastError(error)
        return null
      }
    }
    if (state.currentKind === 'flowTemplate') {
      // 模板态：属性栏「保存」= 保存模板全部内容（覆盖模板库，改模板不改实例）
      const template = currentFlowTemplateOf(state)
      if (!template) return null
      try {
        const saved = await flowTemplates.saveFlowTemplate(template, state.canvas.nodes, state.canvas.edges)
        if (saved) {
          dispatch({ type: 'MARK_SAVED' })
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
          dispatch({ type: 'MARK_SAVED' })
          notify('success', t.toastSaved)
        }
        return saved
      } catch (error) {
        toastError(error)
        return null
      }
    }
    return null
  }, [dispatch, notify, state, toastError, workflows, flowTemplates, serviceControl, t.toastSaved])

  /**
   * 创建实例（图2 交互改造核心）：把当前画布内容保存为「当前会话的实例」。
   *  - 模板态：以模板内容创建新实例（模板不变；实例名 = 模板名，重名追加序号），
   *    保存成功后切到实例态（画布绑定新实例，左栏新实例卡高亮）。
   *  - 实例态：等价于保存实例（名称动态为「保存实例/保存服务」）。
   */
  const createInstanceFromCanvas = useCallback(async (): Promise<WorkflowDocument | null> => {
    // 实例态直接走保存（不变更 id/名称；保存结果可能是服务实例，忽略类型细分）
    if (state.currentKind === 'workflow' || state.currentKind === 'service') {
      const saved = await saveCanvas()
      // 模板→实例仅用于模板态；实例态下返回保存结果（类型上仅工作流文档是运行目标）
      return (state.currentKind === 'workflow' ? saved as WorkflowDocument | null : null)
    }
    if (state.currentKind !== 'flowTemplate') return null
    const template = currentFlowTemplateOf(state)
    if (!template) return null
    try {
      const draft = workflows.instantiateFromTemplate(template)
      // 名称去重：模板名 + 序号（与现有实例名称比较）
      const existing = state.workflows.map((item) => item.name)
      let name = draft.name
      let index = 2
      while (existing.includes(name)) {
        name = `${draft.name} (${index})`
        index += 1
      }
      draft.name = name
      const saved = await workflows.saveWorkflow(draft, state.canvas.nodes, state.canvas.edges)
      if (saved) {
        dispatch({ type: 'MARK_SAVED' })
        workflows.openFlow(saved)
        notify('success', t.toastCreatedInstance)
      }
      return saved
    } catch (error) {
      toastError(error)
      return null
    }
  }, [dispatch, notify, state, toastError, workflows, flowTemplates, saveCanvas, t.toastCreatedInstance])

  /** 实例 → 模板（另存为模板）：当前实例内容复制为全局共享的工作流模板。 */
  const saveCurrentAsFlowTemplate = useCallback(async (): Promise<void> => {
    const source = state.currentKind === 'workflow'
      ? currentFlowOf(state)
      : state.currentKind === 'service'
        ? currentServiceOf(state)
        : null
    if (!source) return
    try {
      const template = flowTemplates.createFlowTemplateDraft(state.mode)
      template.name = source.name
      template.description = source.description ?? ''
      template.nodes = JSON.parse(JSON.stringify(state.canvas.nodes)) as never
      template.lines = JSON.parse(JSON.stringify(state.canvas.edges)) as never
      const saved = await flowTemplates.saveFlowTemplate(template, state.canvas.nodes, state.canvas.edges)
      if (saved) notify('success', t.toastSavedAsTemplate)
    } catch (error) {
      toastError(error)
    }
  }, [dispatch, flowTemplates, notify, state, t.toastSavedAsTemplate, toastError])

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

  const openFlowTemplateById = useCallback((id: string) => {
    const template = state.flowTemplates.find((item) => item.id === id)
    if (!template) return
    flowTemplates.openFlowTemplate(template)
  }, [state.flowTemplates, flowTemplates])

  /** 打开工作流/服务/模板（未保存守卫后切换；模板只在画布中显示、可编辑保存回模板库）。 */
  const selectWorkflow = useCallback((id: string) => {
    if (state.mode === 'mode1') {
      guard.guard(() => openFlowById(id))
    } else {
      guard.guard(() => openServiceById(id))
    }
  }, [guard, openFlowById, openServiceById, state.mode])

  /** 打开工作流模板（未保存守卫后切换；模板态：编辑模板 or 创建实例）。 */
  const selectFlowTemplate = useCallback((id: string) => {
    guard.guard(() => openFlowTemplateById(id))
  }, [guard, openFlowTemplateById])

  // ---------- 新建 ----------
  const createNew = useCallback((tab: LibTab, section?: 'file' | 'database' | 'flowTemplate' | 'group') => {
    if (tab === 'workflow') {
      if (section === 'flowTemplate') {
        // 图2 交互改造：+ 号新建「工作流模板」（空白模板，编辑后保存回模板库；
        // 实例只能从模板拖入画布「创建实例」后产生——实例列表无 + 号）。
        const draft = flowTemplates.createFlowTemplateDraft(state.mode)
        flowTemplates.openFlowTemplate(draft)
        notify('info', t.newWorkflow)
        return
      }
      // 兼容路径：非模板区 + 号（不再提供「新建实例」；提示用户从模板创建）
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
    if (tab === 'other' && section === 'group') {
      // 用户批注：协作组像其他列表一样，标题右侧 + 号新建协作组模板。
      const template = templates.createTemplateDraft('group')
      selection.selectEditor({ source: 'template', kind: 'group', id: template.id })
      selection.selectLib('groupTemplate', (template as { id: string }).id)
      notify('info', t.newTemplate)
      return
    }
  }, [notify, selection, serviceControl, state.mode, state.sessionId, t.newTemplate, t.newWorkflow, flowTemplates, templates, workflows])

  return {
    saveCanvas, createInstanceFromCanvas, saveCurrentAsFlowTemplate,
    openFlowById, openServiceById, openFlowTemplateById,
    selectWorkflow, selectFlowTemplate, createNew,
  }
}
