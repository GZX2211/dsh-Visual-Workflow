// src/client/hooks/useNewSessionOptions.ts
//
// 「开启新会话」+ 工作区路径的交互编排（模板态 / 资产态语义不同）：
//   - 模板态：勾选与路径是**模板级持久化配置**（selector newSessionOptionsOf 从当前模板
//     派生），任一变更立即保存模板（useDocumentActions.setFlowTemplateOptions）；
//   - 资产态：仅勾选为一次性临时选项（dispatch INSTANCE_OPTIONS_SET），
//     资产没有模板文档可承载持久化配置，故不提供路径选择（继承当前会话工作区）；
//   - 目录选择：经注入的官方选择器（宿主接入 sidebar/workspace-picker）打开；
//     取消不改值；不可用/失败给出词典提示，不静默吞掉。
//
// 瞬时渲染态（选择器打开中 picking）留在本 hook，不写入业务状态机；异步结果进入
// 前校验组件生命周期（卸载后不写状态）。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { Dict } from '../i18n.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import { newSessionOptionsOf, type NewSessionOptions } from '../studio/studio-state.js'
import { WorkspacePickerUnavailableError, type WorkspacePicker } from '../sidebar/workspace-picker.js'

/** hook 入参（交互面与宿主能力经注入，不直接触达官方服务）。 */
export interface UseNewSessionOptionsArgs {
  /** 当前工作台状态（只读切片：模板态读模板字段、资产态读临时选项）。 */
  state: StudioState
  /** 状态机 dispatch（资产态一次性选项写入）。 */
  dispatch: Dispatch<StudioAction>
  /** 模板级新会话配置保存（变更即保存模板；失败由该实现回滚并提示）。 */
  setFlowTemplateOptions(patch: { startNewSession?: boolean; workspacePath?: string }): Promise<void>
  /** 轻提示（不可用等需要明确告知的用户可见结果）。 */
  notify(kind: 'info' | 'success' | 'error', text: string): void
  /** 通用错误提示（选择器/保存失败）。 */
  toastError(error: unknown): void
  /** 官方目录选择器（宿主接入层注入；null = 当前环境不可用）。 */
  picker: WorkspacePicker | null
  /** 文案词典。 */
  t: Dict
}

/** 新会话选项交互面（Toolbar 消费）。 */
export interface NewSessionOptionsFace {
  /** 当前生效的新会话选项（模板态来自模板字段；资产态来自临时选项，路径恒空）。 */
  options: NewSessionOptions
  /** 是否显示「选择工作区…」按钮（仅模板态；资产态无持久化归属）。 */
  showWorkspacePicker: boolean
  /** 官方目录选择器当前是否可用（不可用时按钮禁用并提示）。 */
  pickerAvailable: boolean
  /** 目录选择器是否正在打开（防重复打开）。 */
  picking: boolean
  /** 勾选/取消勾选变更（路径变更只经目录选择器，不走本回调）。 */
  onOptionsChange(patch: { newSession?: boolean; workspacePath?: string }): void
  /** 打开官方目录选择器并保存所选路径。 */
  onPickWorkspace(): void
}

/**
 * 新会话选项交互编排 hook。
 * @param args - 状态切片、写入面与宿主选择器注入。
 * @returns 展示值与交互回调（引用在同一 state 下稳定）。
 */
export function useNewSessionOptions(args: UseNewSessionOptionsArgs): NewSessionOptionsFace {
  const { state, dispatch, setFlowTemplateOptions, notify, toastError, picker, t } = args
  const [picking, setPicking] = useState(false)
  /** 防重入标记（同步生效，不依赖一次渲染）。 */
  const busyRef = useRef(false)
  /** 卸载守卫：异步结果只能写回仍存活的组件。 */
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const options = newSessionOptionsOf(state)
  const showWorkspacePicker = state.currentKind === 'flowTemplate'
  const pickerAvailable = showWorkspacePicker && picker !== null && picker.available()

  const onOptionsChange = useCallback((patch: { newSession?: boolean; workspacePath?: string }): void => {
    // 路径只能来自官方目录选择器（需求：改为选择而非填写）；此处只处理勾选
    if (patch.newSession === undefined) return
    if (state.currentKind === 'flowTemplate') {
      // 立即保存模板配置（失败由保存路径回滚并提示）
      void setFlowTemplateOptions({ startNewSession: patch.newSession })
      return
    }
    dispatch({ type: 'INSTANCE_OPTIONS_SET', options: { newSession: patch.newSession } })
  }, [dispatch, setFlowTemplateOptions, state.currentKind])

  const onPickWorkspace = useCallback((): void => {
    if (busyRef.current) return
    const active = picker
    if (active === null || !active.available()) {
      notify('error', t.workspacePickerUnavailable)
      return
    }
    busyRef.current = true
    setPicking(true)
    void active.pick().then((path) => {
      if (!aliveRef.current) return
      if (path !== null) void setFlowTemplateOptions({ workspacePath: path })
    }).catch((error) => {
      if (!aliveRef.current) return
      if (error instanceof WorkspacePickerUnavailableError) notify('error', t.workspacePickerUnavailable)
      else toastError(error)
    }).finally(() => {
      busyRef.current = false
      if (aliveRef.current) setPicking(false)
    })
  }, [notify, picker, setFlowTemplateOptions, t.workspacePickerUnavailable, toastError])

  return {
    options,
    showWorkspacePicker,
    pickerAvailable,
    picking,
    onOptionsChange,
    onPickWorkspace,
  }
}
