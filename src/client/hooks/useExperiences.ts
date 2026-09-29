// src/client/hooks/useExperiences.ts
//
// 经验面（复盘沉淀的可复用知识）：列表加载 / 打开属性栏编辑 / 保存 / 归档 / 恢复。
//
// 语义边界（用户裁决）：经验**没有版本控制**——没有历史版本、没有 Active 指针，
// 状态只有「活跃 / 已归档」两态，归档即退出父代理召回面（内容全部保留，可恢复）。
// 因此本面刻意不提供任何版本列表与回滚入口：属性栏只有「保存」与「归档 / 恢复」。
//
// 职责边界：本 hook 只做「远端调用 + 状态写入 + 失败语义 + toast」；
// 编辑载荷投影（可编辑字段的唯一来源）与保存 / 归档的编排在 useEditorActions。
//
// 失败语义（client AGENTS「数据流与数据访问边界」）：稳定错误码按语义分支——
// ERR_EXPERIENCE_NOT_FOUND（经验不存在）提示并刷新经验列表；其余交给通用错误提示。
// 异步防竞态：列表加载持请求序号，只有最新一次可写状态；卸载后一律不写。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { ExperienceEntry, ExperiencePatch } from '../../host/shared/asset-types.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import type { RemoteError } from '../lib/remote.js'
import type { ToastFace } from './useToast.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

export interface ExperiencesFace {
  experiences: StudioState['experiences']
  experienceDoc: StudioState['experienceDoc']
  /** 重新加载经验列表（活跃 + 已归档）。 */
  refresh(): Promise<void>
  /** 打开经验：详情取自已装载列表（列表里没有该 id 时不做任何事，避免打开空壳）。 */
  open(experienceId: string): void
  /** 保存经验（就地更新可编辑字段；返回更新后的条目，失败 null）。 */
  save(entry: ExperienceEntry): Promise<ExperienceEntry | null>
  /** 归档 / 恢复经验（状态切换唯一入口；返回是否成功）。 */
  setActive(experienceId: string, active: boolean): Promise<boolean>
}

/**
 * 保存载荷投影（纯函数）：只取可编辑字段，只读元信息（id / 来源运行 / 时间戳 / 状态）
 * 一律不回传——回传等于让界面有权改写领域记账的事实。
 * 可空字段用 `null` 表达「清空」（与 `undefined` 的「不改」区分，见共享契约 ExperiencePatch）。
 */
export function experiencePatchOf(entry: ExperienceEntry): ExperiencePatch {
  return {
    taskType: entry.taskType,
    taskContext: entry.taskContext,
    insight: entry.insight,
    evidence: entry.evidence ?? null,
    reviewFeedback: entry.reviewFeedback ?? null,
  }
}

/** 远端错误的稳定码（无码 = 传输/解析失败）。 */
function codeOf(error: unknown): string {
  return String((error as RemoteError | null | undefined)?.code ?? '')
}

/** 远端返回的经验条目归一化（形状漂移一律当作失败，不写入半截数据）。 */
function asEntry(payload: unknown): ExperienceEntry | null {
  const record = payload as { id?: unknown } | null | undefined
  return record && typeof record.id === 'string' && record.id !== '' ? (record as ExperienceEntry) : null
}

/** 经验面（远端失败已就地翻译为提示；返回值 null/false 表示本次调用未产生结果）。 */
export function useExperiences(
  remote: RemoteFace,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  state: StudioState,
): ExperiencesFace {
  /** 卸载守卫：卸载后不再写状态。 */
  const mounted = useRef(true)
  /** 列表请求序号（只有最新一次刷新可写状态）。 */
  const listSeq = useRef(0)
  useEffect(() => () => {
    mounted.current = false
  }, [])
  /** 状态引用：回调闭包读最新列表（打开经验时取当前条目）。 */
  const stateRef = useRef(state)
  stateRef.current = state

  /** 经验失败统一翻译；返回 true = 已按经验语义处理（调用方不再提示）。 */
  const handleFailure = useCallback(async (error: unknown): Promise<boolean> => {
    if (codeOf(error) !== EP.ERR_EXPERIENCE_NOT_FOUND) return false
    notify('error', t.experienceNotFound)
    try {
      const payload = await remote.call(EP.EP_LIST_EXPERIENCES, {})
      if (!mounted.current) return true
      dispatch({ type: 'EXPERIENCES_LOADED', items: Array.isArray(payload) ? payload as ExperienceEntry[] : [] })
    } catch {
      // 刷新失败不再叠加提示（首条提示已说明经验不存在）
    }
    return true
  }, [dispatch, notify, remote, t.experienceNotFound])

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++listSeq.current
    try {
      const payload = await remote.call(EP.EP_LIST_EXPERIENCES, {})
      // 归属校验：只有最新一次刷新可写（旧的迟到响应丢弃）；卸载后不写
      if (!mounted.current || seq !== listSeq.current) return
      dispatch({ type: 'EXPERIENCES_LOADED', items: Array.isArray(payload) ? payload as ExperienceEntry[] : [] })
    } catch (error) {
      if (!mounted.current || seq !== listSeq.current) return
      if (await handleFailure(error)) return
      toastError(error)
    }
  }, [dispatch, handleFailure, remote, toastError])

  const open = useCallback((experienceId: string): void => {
    const entry = stateRef.current.experiences.find((item) => item.id === experienceId)
    if (!entry) return
    dispatch({ type: 'EXPERIENCE_LOADED', entry })
    dispatch({ type: 'OPEN_EXPERIENCE', experienceId })
  }, [dispatch])

  const save = useCallback(async (entry: ExperienceEntry): Promise<ExperienceEntry | null> => {
    try {
      const updated = asEntry(await remote.call(EP.EP_SAVE_EXPERIENCE, { experienceId: entry.id, patch: experiencePatchOf(entry) }))
      if (!updated || !mounted.current) return null
      notify('success', t.toastExperienceSaved)
      // 详情槽与列表项同源刷新（EXPERIENCE_LOADED 同时更新两处），无需再拉一次列表
      dispatch({ type: 'EXPERIENCE_LOADED', entry: updated })
      return updated
    } catch (error) {
      if (await handleFailure(error)) return null
      toastError(error)
      return null
    }
  }, [dispatch, handleFailure, notify, remote, t.toastExperienceSaved, toastError])

  const setActive = useCallback(async (experienceId: string, active: boolean): Promise<boolean> => {
    try {
      const endpoint = active ? EP.EP_RESTORE_EXPERIENCE : EP.EP_RETIRE_EXPERIENCE
      const updated = asEntry(await remote.call(endpoint, { experienceId }))
      if (!updated || !mounted.current) return false
      notify('success', active ? t.toastExperienceRestored : t.toastExperienceRetired)
      dispatch({ type: 'EXPERIENCE_LOADED', entry: updated })
      // 状态切换会让条目在「活跃 / 已归档」两栏间移动，列表以服务端为准重取一次
      await refresh()
      return true
    } catch (error) {
      if (await handleFailure(error)) return false
      toastError(error)
      return false
    }
  }, [dispatch, handleFailure, notify, refresh, remote, t.toastExperienceRestored, t.toastExperienceRetired, toastError])

  return { experiences: state.experiences, experienceDoc: state.experienceDoc, refresh, open, save, setActive }
}
