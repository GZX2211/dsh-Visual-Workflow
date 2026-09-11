// src/client/hooks/useDocumentActions.ts
//
// 文档生命周期操作：保存画布（实例/模板/服务）、模板创建实例、实例另存为
// 模板、打开/选中（未保存守卫包裹）与新建草稿。数据经各列表面 hook 落库，
// 本面只负责编排与 toast 反馈。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import { currentFlowOf, currentFlowTemplateOf, currentServiceOf, instanceRunningOf, type LibTab, type StudioAction, type StudioState } from '../studio/studio-state.js'
import type { WorkflowsFace } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { SelectionFace } from './useSelection.js'
import type { UnsavedGuardFace } from './useUnsavedGuard.js'
import type { ServiceControlFace } from './useServiceControl.js'
import type { RemoteFace } from './useRemote.js'
import type { ToastFace } from './useToast.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

/** 画布保存选项。 */
export interface SaveCanvasOptions {
  /**
   * 纯几何改动的自动保存（节点拖动 / 协作组卡片缩放的防抖保存）：
   * 跳过「运行中保存」二次确认、跳过成功 toast（避免拖动即弹窗/刷屏）。
   * 它不是「编排变更」通道：若画布内容没变，宿主侧 diff 也不会向父代理注入。
   */
  auto?: boolean
}

export interface DocumentActionsFace {
  /** 保存当前画布（实例/模板/服务；成功记录已保存快照并 toast）。返回保存成功的文档（类型为三态并集，与原实现推断一致）。 */
  saveCanvas(options?: SaveCanvasOptions): Promise<WorkflowDocument | WorkflowTemplate | ServiceState | null>
  /**
   * 创建实例（模板态：模板内容存为新实例并切到实例态；实例态等价保存）。
   * 工作台全局化改版：「开启新会话」为一次性临时选项——勾选时先新建主会话，
   * 实例绑定该新会话；未勾选时在**当前主会话**创建，目标会话已有实例则弹
   * 「覆盖旧工作流」二次确认（确认后复用旧实例 id 更新内容）。
   * @param afterCreate 创建/覆盖成功后的回调（异步确认框路径同样触发）；
   *   「运行」入口用它接续启动（因为确认框是异步的，返回值不可依赖）。
   */
  createInstanceFromCanvas(afterCreate?: (created: WorkflowDocument | ServiceState) => void): Promise<WorkflowDocument | null>
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
  remote: RemoteFace,
  t: Dict,
): DocumentActionsFace {
  // ---------- 保存 / 打开 ----------
  const saveCanvas = useCallback(async (options?: SaveCanvasOptions) => {
    const auto = options?.auto === true
    if (state.currentKind === 'workflow') {
      const flow = currentFlowOf(state)
      if (!flow) return null
      /** 真正落库（二次确认确认后与即时路径共用）。 */
      const doSave = async (): Promise<WorkflowDocument | null> => {
        try {
          const saved = await workflows.saveWorkflow(flow, state.canvas.nodes, state.canvas.edges)
          if (saved) {
            // MARK_SAVED：同时记录「已保存图快照」，供撤销/重做精确判定 dirty（Bug 17）
            dispatch({ type: 'MARK_SAVED' })
            // 自动保存（纯几何拖动）静默成功，避免拖动即 toast；失败仍提示
            if (!auto) notify('success', t.toastSaved)
          }
          return saved
        } catch (error) {
          toastError(error)
          return null
        }
      }
      // 运行中保存实例：二次确认（用户裁决 b）——保存会把最新画布同步给父代理
      // 并由宿主注入【编排变更】，父代理据此调整后续编排流程，故必须先确认。
      // 自动保存（纯几何拖动）不弹确认；无未保存改动（dirty=false，例如纯拖动已
      // 自动落库）也直接忽略确认与注入——坐标变动不构成编排变更。
      if (!auto && state.dirty && instanceRunningOf(state)) {
        dispatch({
          type: 'CONFIRM_SET',
          confirm: {
            kind: 'confirmText',
            title: t.saveRunningTitle,
            message: t.saveRunningMessage,
            confirmLabel: t.saveRunningConfirm,
            onConfirm: () => { void doSave() },
          },
        })
        return null
      }
      return await doSave()
    }
    if (state.currentKind === 'flowTemplate') {
      // 模板态：属性栏「保存」= 保存模板全部内容（覆盖模板库，改模板不改实例）
      const template = currentFlowTemplateOf(state)
      if (!template) return null
      try {
        const saved = await flowTemplates.saveFlowTemplate(template, state.canvas.nodes, state.canvas.edges)
        if (saved) {
          dispatch({ type: 'MARK_SAVED' })
          if (!auto) notify('success', t.toastSaved)
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
          if (!auto) notify('success', t.toastSaved)
        }
        return saved
      } catch (error) {
        toastError(error)
        return null
      }
    }
    return null
  }, [dispatch, notify, state, toastError, workflows, flowTemplates, serviceControl, t.saveRunningConfirm, t.saveRunningMessage, t.saveRunningTitle, t.toastSaved])

  /**
   * 创建实例（图2 交互改造核心；工作台全局化改版重写）：
   *  - 实例态：等价于保存实例（名称动态为「保存实例/保存服务」）。
   *  - 模板态（「创建实例」/「创建服务」按钮，或模板态「运行」前置）：
   *      1. 目标会话 = 勾选「开启新会话」？新建主会话（createSession 端点，
   *         一次性临时选项，不持久化）: 当前主会话（state.sessionId）；
   *      2. 目标会话已有同模式实例（每会话单实例）→ 弹二次确认「新运行的工作流
   *         将会覆盖旧的工作流」；确认后**复用旧实例 id 更新内容**（运行历史
   *         按 flowId 连续可追溯）；
   *      3. 保存成功 → 切到实例态（画布绑定新实例，左栏新实例卡高亮）→
   *         afterCreate?.(saved)（「运行」入口接续启动）。
   *  - 返回：即时创建路径返回保存的文档；弹确认框路径返回 null（后续统一经
   *    afterCreate 回调接续，调用方不得依赖返回值判断成功）。
   */
  const createInstanceFromCanvas = useCallback(async (
    afterCreate?: (created: WorkflowDocument | ServiceState) => void,
  ): Promise<WorkflowDocument | null> => {
    // 实例态直接走保存（不变更 id/名称；保存结果可能是服务实例，忽略类型细分）
    if (state.currentKind === 'workflow' || state.currentKind === 'service') {
      const saved = await saveCanvas()
      return (state.currentKind === 'workflow' ? saved as WorkflowDocument | null : null)
    }
    if (state.currentKind !== 'flowTemplate') return null
    const template = currentFlowTemplateOf(state)
    if (!template) return null

    // ---- 目标会话：勾选「开启新会话」→ 新建主会话（一次性动作） ----
    const { newSession, workspacePath } = state.instanceOptions
    let targetSessionId = state.sessionId
    if (newSession) {
      try {
        const created = await remote.call(EP.EP_CREATE_SESSION, {
          sessionId: state.sessionId,
          ...(String(workspacePath ?? '').trim() ? { workspacePath: String(workspacePath).trim() } : {}),
          label: `${t.sessionLabelWorkflowPrefix}${template.name ?? ''}`,
        }) as { sessionId?: unknown }
        targetSessionId = String(created?.sessionId ?? '')
        if (!targetSessionId) throw new Error('新建会话失败：未返回会话 id')
      } catch (error) {
        toastError(error)
        return null
      }
    }

    // ---- 每会话单实例（按模式各一）：目标会话已有同模式实例 → 覆盖确认 ----
    const existing = state.mode === 'mode1'
      ? state.workflows.find((item) => item.sessionId === targetSessionId)
      : state.services.find((item) => item.sessionId === targetSessionId)
    // 模式二覆盖运行中的服务实例：拒绝（先停止再覆盖，避免定义与运行状态脱节）
    if (existing && state.mode === 'mode2' && (existing as ServiceState).status === 'running') {
      notify('error', t.toastServiceRunningCannotOverwrite)
      return null
    }

    /** 实际创建/覆盖（确认框 onConfirm 与即时路径共用）。 */
    const doCreate = async (): Promise<void> => {
      try {
        if (state.mode === 'mode1') {
          const source = existing as WorkflowDocument | undefined
          const draft: WorkflowDocument = source
            ? {
                // 覆盖：复用旧实例 id/sessionId/createdAt（revision 保存层 +1），
                // 名称/内容 = 模板最新定义 ——「新运行的工作流覆盖旧的工作流」
                id: source.id,
                sessionId: source.sessionId,
                mode: template.mode,
                name: template.name ?? source.name,
                description: template.description ?? '',
                revision: Number(source.revision ?? 0),
                nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as WorkflowDocument['nodes'],
                lines: JSON.parse(JSON.stringify(template.lines ?? [])) as WorkflowDocument['lines'],
                createdAt: source.createdAt,
              }
            : workflows.instantiateFromTemplate(template, targetSessionId)
          const saved = await workflows.saveWorkflow(draft, state.canvas.nodes, state.canvas.edges)
          if (!saved) return
          dispatch({ type: 'MARK_SAVED' })
          workflows.openFlow(saved)
          notify('success', source ? t.toastInstanceOverwritten : t.toastCreatedInstance)
          afterCreate?.(saved)
        } else {
          const source = existing as ServiceState | undefined
          const draft: ServiceState = source
            ? {
                id: source.id,
                sessionId: source.sessionId,
                name: template.name ?? source.name,
                description: template.description ?? '',
                revision: Number(source.revision ?? 0),
                nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as ServiceState['nodes'],
                lines: JSON.parse(JSON.stringify(template.lines ?? [])) as ServiceState['lines'],
                createdAt: source.createdAt,
                updatedAt: new Date().toISOString(),
                // 覆盖仅非运行态可达（上方已拒绝 running）；保留既有进程状态
                status: source.status,
              }
            : serviceControl.instantiateFromTemplate(template, targetSessionId)
          const saved = await serviceControl.saveService(draft, state.canvas.nodes, state.canvas.edges)
          if (!saved) return
          dispatch({ type: 'MARK_SAVED' })
          notify('success', source ? t.toastInstanceOverwritten : t.toastCreatedInstance)
          afterCreate?.(saved)
        }
      } catch (error) {
        toastError(error)
      }
    }

    if (existing) {
      // 二次确认（图片批注④）：确认后覆盖（复用旧实例 id）并接续原动作
      dispatch({
        type: 'CONFIRM_SET',
        confirm: {
          kind: 'confirmText',
          title: t.overwriteInstanceTitle,
          message: t.overwriteInstanceMessage,
          confirmLabel: t.overwriteInstanceConfirm,
          onConfirm: () => { void doCreate() },
        },
      })
      return null
    }
    await doCreate()
    return null
  }, [dispatch, notify, remote, saveCanvas, serviceControl, state, t, toastError, workflows])

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
