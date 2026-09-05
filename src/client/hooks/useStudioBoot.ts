// src/client/hooks/useStudioBoot.ts
//
// 工作台初始化加载（工作台全局化改版）：并行拉取**全部会话**的工作流/服务
// 实例、模板，补齐内置父代理模板，拉取生态枚举（presets/tools/models/combos）
// 与**全部会话**的活跃 run；随后按「当前主会话」自动选中实例（规则见
// pickInitialInstanceForSession：当前会话实例运行中 > 暂停 > 最新；当前会话无
// 实例则保持空白画布——不再回退到其他会话的实例）。
//
// 「当前主会话」（会话树根）仅用于默认选中与标签；实例列表本身是跨会话全量。

import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { ModelItem, PresetItem, StudioAction, StudioState, ToolItem } from '../studio/studio-state.js'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import type { RemoteFace } from './useRemote.js'
import type { WorkflowsFace } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { ServiceControlFace } from './useServiceControl.js'
import type { ToastFace } from './useToast.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

/** 自动选中实例判定（当前主会话实例列表 + 全量活跃 run；运行中>暂停>最新）。 */
type PickInitialInstance = (
  currentSessionInstances: Array<{ id: string; name?: string; updatedAt?: string }>,
  activeRuns: Array<{ flowId: string; status: string }>,
) => string | null

/** 初始化加载（工作台全局化：挂载时执行一次；列表为全量跨会话）。 */
export function useStudioBoot(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  _notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  _t: Dict,
  remote: RemoteFace,
  workflows: WorkflowsFace,
  flowTemplates: FlowTemplatesFace,
  templates: TemplatesFace,
  serviceControl: ServiceControlFace,
  pickInitialInstance: PickInitialInstance,
): void {
  // 会话 id 经 ref 读取：boot 只在挂载时执行一次——工作台全局化后列表是全量
  // 跨会话的，DSH 会话切换不应重新加载/自动选中（用户裁决：打开期间切换仅更新
  // 「当前」标签，不强制跳转画布；重新打开工作台（重新 mount）时才按新当前会话
  // 自动选中）。
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    let cancelled = false
    // 用「加载返回的最新列表」而非闭包里的 state.workflows/services：
    // boot 的 effect 在挂载时执行，闭包中的 state 是首次渲染的空数组，
    // 直接读 state.workflows 会误判「无实例」而提前 return，导致重挂载/重新进入后
    // 画布空白、运行状态不恢复（图2-6 状态消失根因）。
    const bootedSessionId = () => stateRef.current.sessionId
    let loadedWorkflows: WorkflowDocument[] = []
    let loadedServices: ServiceState[] = []
    const boot = async (): Promise<void> => {
      // 全部会话实例列表（工作台全局化：端点无 sessionId 过滤——即使当前会话
      // 未激活也可加载；仅「自动选中」与「当前」标签依赖当前会话 id）
      try {
        const [flows, , services] = await Promise.all([
          workflows.loadWorkflows(),
          flowTemplates.loadFlowTemplates(),
          serviceControl.loadServices(),
        ])
        loadedWorkflows = flows ?? []
        loadedServices = services ?? []
      } catch (error) {
        if (!cancelled) toastError(error)
      }
      try {
        // Bug 5：loadTemplates 直接返回三类结果（已含 role），消除重复发起的
        // EP_LIST_TEMPLATES 叠加请求——原先查询与创建之间无同步，创建成功但
        // 列表未刷新（部分更新）时内置父代理模板缺失。
        const loaded = await templates.loadTemplates()
        // 内置父代理模板：模板库首次启动时补齐（角色 Tab 置顶固定显示，§4.2.3.1）
        const roleItems = loaded.role ?? []
        if (!roleItems.some((item) => (item as { kind?: string }).kind === 'parent')) {
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
          if (cancelled) return // 卸载后不再刷新（避免卸载后 dispatch）
          await templates.loadTemplates() // 刷新列表（含新建内置模板）
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
        dispatch({ type: 'PRESETS_LOADED', items: Array.isArray(presets) ? presets as PresetItem[] : [] })
        dispatch({ type: 'TOOLS_LOADED', items: Array.isArray(tools) ? tools as ToolItem[] : [] })
        dispatch({ type: 'MODELS_LOADED', items: Array.isArray(models) ? models as ModelItem[] : [] })
        dispatch({ type: 'COMBOS_LOADED', items: Array.isArray(combos) ? combos : [] })
      }
      await enums()

      // 全量活跃 run（工作台全局化：实例列表状态徽标 + 自动选中匹配）
      let activeRuns: Array<{ flowId: string; status: string; runId: string; sessionId: string }> = []
      try {
        const items = await remote.call(EP.EP_ACTIVE_RUNS, {}) as Array<{ flowId: string; status: string; runId: string; sessionId: string }> | null
        activeRuns = Array.isArray(items) ? items : []
        if (!cancelled) dispatch({ type: 'ACTIVE_RUNS_LOADED', items: activeRuns })
      } catch {
        // 活跃 run 查询失败不阻断（列表徽标缺省、自动选中回退当前会话实例第一个）
      }

      // 「进入工作台自动选中实例」（工作台全局化改版）：每次点击悬浮窗进入时
      // （浮窗关闭即卸载 Studio、重开重新 mount → boot 重跑），若**当前主会话**
      // 有实例则默认选中并显示在画布（运行中优先、其次暂停、否则最新）——
      // 从任何会话进入，画布都显示「与当前会话对应」的实例；当前会话无实例则
      // 保持空白画布（不自动打开其他会话的实例）。用最新加载列表直接 dispatch。
      const currentSessionId = bootedSessionId()
      if (cancelled || !currentSessionId) return
      if (stateRef.current.mode === 'mode1') {
        const currentSessionFlows = loadedWorkflows.filter((f) => f.sessionId === currentSessionId)
        if (currentSessionFlows.length === 0) return // 空列表保持空白画布
        const targetId = pickInitialInstance(currentSessionFlows, activeRuns)
        if (targetId) {
          const target = currentSessionFlows.find((f) => f.id === targetId)
          if (target) dispatch({ type: 'OPEN_FLOW', flow: target })
          // 图2-6：退出工作台再进入状态消失——若选中实例存在活动 run，在其打开后
          // 恢复 runId，触发 useRunPolling 重建轮询并拉回快照，画布节点/实例卡状态不再消失。
          const active = activeRuns.find((a) => a.flowId === targetId && a.sessionId === currentSessionId)
          if (active?.runId) dispatch({ type: 'RUN_STARTED', runId: active.runId, runSessionId: active.sessionId })
        }
      } else {
        const currentSessionServices = loadedServices.filter((s) => s.sessionId === currentSessionId)
        if (currentSessionServices.length === 0) return
        const targetId = pickInitialInstance(currentSessionServices, activeRuns)
        if (targetId) {
          const target = currentSessionServices.find((s) => s.id === targetId)
          if (target) dispatch({ type: 'OPEN_SERVICE', service: target })
          const active = activeRuns.find((a) => a.flowId === targetId && a.sessionId === currentSessionId)
          if (active?.runId) dispatch({ type: 'RUN_STARTED', runId: active.runId, runSessionId: active.sessionId })
        }
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/**
 * 进入工作台自动选中实例（工作台全局化改版）：从**当前主会话**的实例列表中
 * 选出默认打开的实例 id。规则（优先级）：
 *   1. 正在运行的实例——activeRuns 中 status='running' 且归属当前会话的 flowId；
 *   2. 已暂停的实例——status='paused' 的当前会话实例；
 *   3. 实例列表第一个（后端按 updatedAt 倒序 = 最新）；
 * 校验：activeRuns 的 flowId 必须在该实例列表中（否则忽略该条目）；
 * 当前会话无实例时由调用方提前 return（保持空白画布），本函数入参即已过滤后
 * 的当前会话实例列表。
 */
export function pickInitialInstanceForSession(
  currentSessionInstances: Array<{ id: string; name?: string; updatedAt?: string }>,
  activeRuns: Array<{ flowId: string; status: string }>,
): string | null {
  if (!currentSessionInstances || currentSessionInstances.length === 0) return null
  const idSet = new Set(currentSessionInstances.map((item) => item.id))
  const running = activeRuns.find((run) => run.status === 'running' && idSet.has(run.flowId))
  if (running) return running.flowId
  const paused = activeRuns.find((run) => run.status === 'paused' && idSet.has(run.flowId))
  if (paused) return paused.flowId
  return currentSessionInstances[0].id
}
