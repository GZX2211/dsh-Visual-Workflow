// src/client/hooks/useEditorActions.ts
//
// 编辑器/选择操作面：左侧库卡片选中、编辑器字段 patch、保存编辑器对象，
// 以及删除编辑器对象（草稿直删 / 已入库走确认框 + 后端删除 / 节点连线级联）。
//
// 资产态（模版晋升形态）的编排也在本面：
//   - 入库：先保存模版（工作流模版走画布保存、角色模版走模板库保存），保存未落库即中止；
//   - 保存：先做影响面预览（Host 判定），有牵连即二次确认后登记资产新版本（永不改写历史版本）；
//   - 回滚：归档资产的回滚即重新启用；画布角色节点回滚后同步刷新其角色字段；
//   - 归档：二次确认后移出活跃复用面（历史与版本内容全保留，绝无删除语义）。

import { useCallback, useMemo, useRef } from 'react'
import type { Dispatch } from 'react'
import type { AssetKind, RoleAssetDetail, RoleAssetReference, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../../host/shared/asset-types.js'
import type { LibSelKind, StudioAction, StudioState } from '../studio/studio-state.js'
import { currentFlowOf, currentServiceOf } from '../studio/studio-state.js'
import type { WorkflowsFace } from './useWorkflows.js'
import { serializeWorkflow } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { SelectionFace } from './useSelection.js'
import type { RemoteFace } from './useRemote.js'
import type { ToastFace } from './useToast.js'
import type { DocumentActionsFace } from './useDocumentActions.js'
import type { CanvasActionsFace } from './useCanvasActions.js'
import type { AssetsFace } from './useAssets.js'
import type { RunLockSet } from '../lib/run-locks.js'
import type { Dict } from '../i18n.js'
import { isRoleAssetDetail, roleAssetContentOf } from '../lib/asset-to-node.js'
import { EP } from '../lib/remote.js'

export interface EditorActionsFace {
  selectLibraryCard(kind: LibSelKind, id: string): void
  patchEditor(patch: Record<string, unknown>): void
  /**
   * 保存当前编辑对象（实例/模版/资产）：返回非 null/undefined = 本次已真实落库。
   * 未保存守卫「保存并继续」据此接续原操作（需要二次确认的路径本次返回 null，
   * 由 onSaved 在真实落库后转达）。
   */
  saveEditor(options?: { onSaved?: () => void }): Promise<unknown>
  deleteEditor(): Promise<void>
  /** 模版 → 资产入库（先保存模版；保存未落库即中止）。 */
  promoteEditor(): Promise<void>
  /** 模版态「入库」是否锁定（已入库且模版内容未再修改）。 */
  promoteLocked: boolean
  /** 打开资产版本上拉列表（回滚选择）。 */
  openAssetVersions(): Promise<void>
  /** 回滚到历史版本（只改 Active 指针）；无论成败都收起列表。 */
  rollbackAssetVersion(versionId: number): Promise<void>
}

/** 编辑器面外部依赖（运行中画布锁定判定）。 */
export interface EditorActionsOptions {
  /** 运行中锁定集：被锁连线的字段编辑直接忽略（防「运行前已选中」的旁路改写）。 */
  locks: RunLockSet
}

/**
 * 模版态「入库」目标（纯函数）：工作流模版 → workflow、角色模版 → role；
 * 其余模版（文件/数据库/协作组）与实例态/资产态均无入库目标（返回 null）。
 */
export function promoteTargetOf(state: StudioState): { kind: AssetKind; templateId: string } | null {
  const editor = state.editor
  if (!editor) return null
  if (editor.source === 'flowTemplate') return { kind: 'workflow', templateId: editor.id }
  if (editor.source === 'template' && editor.kind === 'role') return { kind: 'role', templateId: editor.id }
  return null
}

/**
 * 入库按钮锁定判据（纯函数）：该模版已入库，且模版内容自入库起未再修改。
 * 判据 = 资产条目 sourceTemplateId 命中当前模版，且入库时指纹（sourceFingerprint）
 * 与模版当前指纹（currentTemplateFingerprint）相等；模版已删除（指纹缺失）视为未锁定
 * ——此时按「可入库」放行，由后端按模版不存在报错。
 */
export function isPromoteLocked(
  summaries: ReadonlyArray<Pick<WorkflowAssetSummary | RoleAssetSummary, 'sourceTemplateId' | 'sourceFingerprint' | 'currentTemplateFingerprint'>>,
  templateId: string,
): boolean {
  return summaries.some((item) => item.sourceTemplateId === templateId
    && typeof item.sourceFingerprint === 'string'
    && item.sourceFingerprint !== ''
    && item.sourceFingerprint === item.currentTemplateFingerprint)
}

/** 当前模版态的入库锁定（无入库目标 → 未锁定）。 */
export function promoteLockedOf(state: StudioState): boolean {
  const target = promoteTargetOf(state)
  if (!target) return false
  return isPromoteLocked(target.kind === 'workflow' ? state.assets.workflows : state.assets.roles, target.templateId)
}

/**
 * 当前编辑器指向的可回滚资产（资产态保存 / 回滚 / 归档的定位依据）。
 *
 * 除「属性栏编辑的资产」外，画布角色节点也算：节点绑定的 data.sourceAssetId 就是它的
 * 来源资产（批注：画布中的角色节点要与左侧栏角色资产具备同样的回滚能力）。
 * 返回值带 nodeId：回滚成功后要把结果刷新回该节点的角色字段。
 */
function assetTargetOf(state: StudioState): { kind: AssetKind; assetId: string; nodeId?: string } | null {
  const editor = state.editor
  if (!editor) return null
  if (editor.source === 'flowAsset') return { kind: 'workflow', assetId: editor.id }
  if (editor.source === 'roleAsset') return { kind: 'role', assetId: editor.id }
  if (editor.source === 'node') {
    const node = state.canvas.nodes.find((item) => item.id === editor.id)
    const sourceAssetId = typeof node?.data?.sourceAssetId === 'string' ? node.data.sourceAssetId : ''
    if (sourceAssetId !== '') return { kind: 'role', assetId: sourceAssetId, nodeId: editor.id }
  }
  return null
}

/** 牵连资产清单的可读名称串（确认框文案；名称缺失时回退 assetId）。 */
function affectedNamesOf(affected: readonly RoleAssetReference[]): string {
  return affected.map((item) => (item.name !== '' ? item.name : item.assetId)).join('、')
}

/**
 * 工作流资产保存内容：元信息（mode/名称/描述/meta）取已装载详情（名称/描述经 DOC_PATCH
 * 写回 assetDoc），图内容取当前画布——资产态画布即编辑中的草稿，与实例态保存同口径；
 * 节点/连线经统一序列化剔除画布视图字段。
 */
function workflowAssetPayload(state: StudioState, detail: WorkflowAssetDetail): Record<string, unknown> {
  const serialized = serializeWorkflow(
    {
      id: detail.assetId,
      sessionId: state.sessionId,
      mode: detail.mode,
      name: detail.name,
      description: detail.description,
      nodes: detail.nodes,
      lines: detail.lines,
    },
    state.canvas.nodes,
    state.canvas.edges,
  )
  return {
    mode: detail.mode,
    name: detail.name,
    description: detail.description,
    nodes: serialized.nodes,
    lines: serialized.lines,
    ...(detail.meta ? { meta: detail.meta } : {}),
  }
}

/** 角色资产保存内容（字段域与 RoleAssetDetail 一致；assetId 由端点参数定位，不进内容）。 */
function roleAssetPayload(detail: RoleAssetDetail): Record<string, unknown> {
  return {
    kind: detail.kind,
    name: detail.name,
    systemPrompt: detail.systemPrompt,
    provider: detail.provider,
    model: detail.model,
    reasoning: detail.reasoning,
    presetId: detail.presetId,
    retryLimit: detail.retryLimit,
    reactLimit: detail.reactLimit,
    inputSchema: detail.inputSchema,
    outputSchema: detail.outputSchema,
    systemPromptSource: detail.systemPromptSource,
    injectSystemPrompt: detail.injectSystemPrompt,
    injectToolSections: detail.injectToolSections,
    promptFilePath: detail.promptFilePath,
  }
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
  assets: AssetsFace,
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
  /**
   * 最新状态的 ref：删除是「先落库、后清画布」的两段式，回调里的 state 闭包是删除发起时的
   * 快照，判断不了「期间用户是否已切到别的文档」。ref 每次渲染更新，回调读它即当前事实。
   */
  const stateRef = useRef(state)
  stateRef.current = state

  /**
   * 删除落库后的画布归属校验（缺陷修复：删除在途切文档会误清新文档的画布）：
   *   - 被删对象仍是当前打开的文档 → 照旧清空画布（用户预期）；
   *   - 期间已打开**别的**文档 → 只移除列表项，绝不动新文档的画布；
   *   - 期间未打开任何文档（currentId=null，例如切换模式已清空画布）→ 没有他人的
   *     画布需要保护，照旧清空（保持既有行为，清空本身无副作用）。
   */
  const clearCanvasIfOwned = useCallback((kind: 'workflow' | 'service' | 'flowTemplate', id: string) => {
    const live = stateRef.current
    if (live.currentId !== null && (live.currentKind !== kind || live.currentId !== id)) return
    dispatch({ type: 'CLEAR_CANVAS' })
  }, [dispatch])

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
    if (editor.source === 'workflow' || editor.source === 'service' || editor.source === 'flowTemplate' || editor.source === 'flowAsset') {
      // 资产态名/描述与实例/模版同路径（DOC_PATCH 按 currentKind 落到对应文档槽）
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
    if (editor.source === 'roleAsset') {
      // 角色资产字段域只有 name（属性栏 NameField 同时下发 label/name）：此处消毒 label
      const normalized = { ...patch }
      if (normalized.name === undefined && normalized.label !== undefined) normalized.name = normalized.label
      delete normalized.label
      dispatch({ type: 'ROLE_ASSET_PATCH', patch: normalized })
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

  // ---------- 保存 / 入库 / 回滚编辑器对象 ----------

  /**
   * 资产保存前的级联二次确认（用户裁决 A：只做「影响面告知」，不做真级联）。
   *
   * 为什么先问 Host 再弹框：哪些角色资产会被登记新版本、谁还引用着它们，全部是 Host 的
   * 事实（预览端点与登记路径共用同一判据）；客户端自行推演会在「预览说没事、保存却牵连」
   * 时分叉。内容未变更时预览返回空列表 → 不打扰用户。
   *
   * @returns true = 已弹确认框（本次调用不落库），用户确认后经 onConfirm 继续真实保存
   */
  const needsCascadeConfirm = useCallback(async (
    kind: AssetKind,
    assetId: string,
    payload: unknown,
    messageOf: (names: string) => string,
    proceed: () => void,
  ): Promise<boolean> => {
    const affected = await assets.previewCascade(kind, assetId, payload)
    if (affected.length === 0) return false
    dispatch({
      type: 'CONFIRM_SET',
      confirm: {
        kind: 'confirmText',
        title: t.assetCascadeTitle,
        message: messageOf(affectedNamesOf(affected)),
        confirmLabel: t.assetCascadeConfirm,
        onConfirm: proceed,
      },
    })
    return true
  }, [assets, dispatch, t.assetCascadeConfirm, t.assetCascadeTitle])

  const saveEditor = useCallback(async (options?: { onSaved?: () => void }): Promise<unknown> => {
    const editor = state.editor
    if (!editor) return null
    const onSaved = options?.onSaved
    if (
      editor.source === 'workflow' || editor.source === 'service' || editor.source === 'flowTemplate'
      || editor.source === 'node' || editor.source === 'edge'
    ) {
      return await saveCanvas({ onSaved })
    }
    if (editor.source === 'template') {
      const template = state.templates[editor.kind].find((item) => item.id === editor.id)
      if (!template) return null
      try {
        await templates.saveTemplate(editor.kind, template)
        notify('success', t.toastSaved)
        onSaved?.()
        return template
      } catch (error) {
        toastError(error)
        return null
      }
    }
    if (editor.source === 'flowAsset') {
      // 资产态保存 = 登记该资产的新版本（历史版本内容永不被改写）
      const detail = state.assetDoc
      if (!detail || detail.assetId !== editor.id) return null
      const payload = workflowAssetPayload(state, detail)
      const doSave = async (): Promise<unknown> => {
        const result = await assets.saveVersion('workflow', detail.assetId, payload)
        if (!result) return null
        if (state.currentKind === 'flowAsset' && state.currentId === detail.assetId) {
          // 画布正打开该资产：重装载详情并重投影画布（清除 dirty + 更新已保存快照，
          // 对齐实例态保存语义）。装载失败则保留画布现状（未落库的编辑不丢）。
          const reloaded = await assets.loadAsset('workflow', detail.assetId)
          if (reloaded) dispatch({ type: 'OPEN_FLOW_ASSET', assetId: detail.assetId })
        }
        onSaved?.()
        return result
      }
      // 无未保存改动时内容与已入库版本全等：保存只会被后端判为「内容未变化」，
      // 不可能为任何角色资产登记新版本，也就没有影响面可告知——省掉一次预览往返
      // （重复点击保存是「无改动保存」的最常见来源）。
      const pending = state.dirty
        ? await needsCascadeConfirm(
          'workflow', detail.assetId, payload,
          (names) => t.assetCascadeWorkflowMessage.replace('{names}', names),
          () => { void doSave() },
        )
        : false
      if (pending) return null
      return await doSave()
    }
    if (editor.source === 'roleAsset') {
      const detail = state.assetRoleDoc
      if (!detail || detail.assetId !== editor.id) return null
      const payload = roleAssetPayload(detail)
      const doSave = async (): Promise<unknown> => {
        const result = await assets.saveVersion('role', detail.assetId, payload)
        if (!result) return null
        // 重装载 Active 详情：属性栏数据源与新版本号/行 id 保持同源
        await assets.loadAsset('role', detail.assetId)
        onSaved?.()
        return result
      }
      const pending = await needsCascadeConfirm(
        'role', detail.assetId, payload,
        (names) => t.assetCascadeRoleMessage.replace('{names}', names),
        () => { void doSave() },
      )
      if (pending) return null
      return await doSave()
    }
    return null
  }, [assets, dispatch, needsCascadeConfirm, notify, saveCanvas, state, t.assetCascadeRoleMessage, t.assetCascadeWorkflowMessage, t.toastSaved, templates, toastError])

  const promoteEditor = useCallback(async () => {
    const target = promoteTargetOf(state)
    if (!target) return
    // 已入库且模版未再修改：按钮已禁用，这里再兜一层（防快捷键/回调旁路重复入库）
    if (promoteLockedOf(state)) return
    // 入库包含保存：先落模版，未落库（保存失败/待确认）即中止，不入库
    if (target.kind === 'workflow') {
      const saved = await saveCanvas()
      if (!saved) return
    } else {
      const template = state.templates.role.find((item) => item.id === target.templateId)
      if (!template) return
      try {
        await templates.saveTemplate('role', template)
        notify('success', t.toastSaved)
      } catch (error) {
        toastError(error)
        return
      }
    }
    await assets.promote(target.kind, target.templateId)
  }, [assets, notify, saveCanvas, state, t.toastSaved, templates, toastError])

  const openAssetVersions = useCallback(async () => {
    const target = assetTargetOf(state)
    if (!target) return
    await assets.openVersions(target.kind, target.assetId)
  }, [assets, state])

  const rollbackAssetVersion = useCallback(async (versionId: number) => {
    const target = assetTargetOf(state)
    if (!target) return
    const detail = await assets.rollback(target.kind, target.assetId, versionId)
    // 只有回滚真正生效才收起列表：失败时保留列表，用户可直接改选另一个版本重试
    if (!detail) return
    assets.closeVersions()
    // 画布角色节点是该资产的画布内联副本：回滚要把节点角色字段刷新为所选版本内容。
    // 归属（groupId）与绑定（sourceAssetId）不在刷新字段集内——它们属于画布，不属于资产内容。
    if (target.nodeId !== undefined && isRoleAssetDetail(detail)) {
      dispatch({ type: 'NODE_DATA_PATCH', id: target.nodeId, patch: roleAssetContentOf(detail) })
    }
  }, [assets, dispatch, state])

  const promoteLocked = useMemo(() => promoteLockedOf(state), [state])

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
              // 归属校验：删除期间用户已切到别的文档 → 不清新文档的画布
              clearCanvasIfOwned('workflow', flow.id)
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
              // 归属校验：删除期间用户已切到别的文档 → 不清新文档的画布
              clearCanvasIfOwned('service', service.id)
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
        // 归属校验：删除期间用户已切到别的模板/实例 → 不清新文档的画布
        clearCanvasIfOwned('flowTemplate', template.id)
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
    if (editor.source === 'flowAsset' || editor.source === 'roleAsset') {
      // 资产态「归档」（Active 移除、历史与版本内容全保留）：必须二次确认。
      // 角色资产被其他工作流资产引用时，归档会改变父代理的召回面，故须显式告知影响面。
      const kind: AssetKind = editor.source === 'flowAsset' ? 'workflow' : 'role'
      const assetId = editor.id
      const roleDetail = kind === 'role' ? state.assetRoleDoc : null
      // 已归档资产不再重复归档（按钮已置灰，这里再兜一层防快捷键/回调旁路）
      if (roleDetail?.retired === true || (kind === 'workflow' && state.assetDoc?.retired === true)) return
      /**
       * 影响面取**资产级**引用聚合（referencingWorkflowAssets），不取单版本行的
       * referenceWorkflowIds：后者按版本行记录、新版本行从零开始，会给出「shared 资产被
       * 0 个工作流引用」这种与类型定义矛盾、且误导用户确认操作的读数。
       */
      const references = roleDetail?.referencingWorkflowAssets ?? []
      const message = references.length > 0
        ? t.assetRetireSharedMessage
          .replace('{count}', String(references.length))
          .replace('{names}', affectedNamesOf(references))
        : t.assetRetireMessage
      dispatch({
        type: 'CONFIRM_SET',
        confirm: {
          kind: 'confirmText',
          title: t.assetRetireTitle,
          message,
          confirmLabel: t.assetRetireConfirm,
          onConfirm: () => {
            // retire 面自身按稳定错误码提示（失败已 toast）；本面只在**归档成功**时收起
            // 已归档资产的界面残留——失败时保持现场（确认框收起、资产卡仍在列表里可重试）
            void assets.retire(kind, assetId).then((retired) => {
              if (retired) dispatch({ type: 'ASSET_CLOSED', assetId })
              else dispatch({ type: 'CONFIRM_SET', confirm: null })
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
  }, [assets, clearCanvasIfOwned, dispatch, notify, removeLine, removeSelected, state, t.assetRetireConfirm, t.assetRetireMessage, t.assetRetireSharedMessage, t.assetRetireTitle, t.confirmDelete, t.deleteFlow, t.toastDeleted, templates, flowTemplates, toastError, workflows])

  return {
    selectLibraryCard, patchEditor, saveEditor, deleteEditor,
    promoteEditor, promoteLocked, openAssetVersions, rollbackAssetVersion,
  }
}
