// src/client/hooks/useStudioBoot.ts
//
// 工作台初始化加载：会话绑定后并行拉取工作流/模板/服务，补齐内置父代理
// 模板，拉取生态枚举（presets/tools/models/combos），并按「自动选中实例」
// 规则打开默认实例（运行中优先、其次暂停、否则列表第一个）。

import { useEffect } from 'react'
import type { Dispatch } from 'react'
import type { ModelItem, PresetItem, StudioAction, StudioState, ToolItem } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import type { WorkflowsFace } from './useWorkflows.js'
import type { FlowTemplatesFace } from './useFlowTemplates.js'
import type { TemplatesFace } from './useTemplates.js'
import type { ServiceControlFace } from './useServiceControl.js'
import type { ToastFace } from './useToast.js'
import type { DocumentActionsFace } from './useDocumentActions.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

/** 自动选中实例判定（实例列表 + 活跃运行；运行中>暂停>列表第一个）。 */
type PickInitialInstance = (
  instances: Array<{ id: string; name?: string }>,
  activeRuns: Array<{ flowId: string; status: string }>,
) => string | null

/** 初始化加载（会话未激活时仅提示；卸载后不再 dispatch）。 */
export function useStudioBoot(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  remote: RemoteFace,
  workflows: WorkflowsFace,
  flowTemplates: FlowTemplatesFace,
  templates: TemplatesFace,
  serviceControl: ServiceControlFace,
  openFlowById: DocumentActionsFace['openFlowById'],
  openServiceById: DocumentActionsFace['openServiceById'],
  pickInitialInstance: PickInitialInstance,
): void {
  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      // 会话未激活（浮窗路径下为空）：不请求需要 sessionId 的端点（避免 400），
      // 提示用户在对话区先发送一条消息激活会话（会话出现后经 subscribe 重新挂载）
      if (state.sessionId) {
        try {
          await Promise.all([
            workflows.loadWorkflows(),
            flowTemplates.loadFlowTemplates(),
            serviceControl.loadServices(state.sessionId),
          ])
        } catch (error) {
          if (!cancelled) toastError(error)
        }
      } else {
        notify('info', t.currentSessionUnavailable)
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

      // 「进入工作台自动选中实例」（用户新增需求）：每次点击悬浮窗进入时（浮窗关闭
      // 即卸载 Studio、重开重新 mount → boot 重跑），若实例列表非空则默认选中并显示
      // 在画布——优先正在运行的实例（activeRuns 查询，running 优先于 paused），否则
      // 列表第一个；实例列表为空则保持空白画布。
      if (cancelled || !state.sessionId) return
      try {
        const activeRuns = await remote.call(EP.EP_ACTIVE_RUNS, { sessionId: state.sessionId }) as Array<{ flowId: string; status: string; runId: string }> | null
        // 按当前模式选择目标实例列表：mode1=工作流实例、mode2=服务实例
        if (state.mode === 'mode1') {
          const flows = state.workflows
          if (flows.length === 0) return // 空列表保持空白画布
          const targetId = pickInitialInstance(flows.map((f) => ({ id: f.id, name: f.name })), activeRuns ?? [])
          if (targetId) {
            openFlowById(targetId)
            // 图2-6：退出工作台再进入状态消失——若选中实例存在活动 run，恢复 runId，
            // 从而触发 useRunPolling 重建轮询并拉回快照，画布节点/实例卡状态不再消失。
            const active = (activeRuns ?? []).find((a) => a.flowId === targetId)
            if (active?.runId) dispatch({ type: 'RUN_STARTED', runId: active.runId })
          }
        } else {
          const services = state.services
          if (services.length === 0) return
          const targetId = pickInitialInstance(services.map((s) => ({ id: s.id, name: s.name })), activeRuns ?? [])
          if (targetId) openServiceById(targetId)
        }
      } catch {
        // 活跃 run 查询失败不阻断自动选中（回退到列表第一个实例）
        if (state.mode === 'mode1' && state.workflows.length > 0) {
          openFlowById(state.workflows[0].id)
        } else if (state.mode === 'mode2' && state.services.length > 0) {
          openServiceById(state.services[0].id)
        }
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId])
}
