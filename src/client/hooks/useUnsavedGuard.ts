// src/client/hooks/useUnsavedGuard.ts
//
// 未保存修改守卫：dirty 时先弹三选项（保存/放弃/取消），确认后再继续。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction, ConfirmState, StudioState } from '../studio/studio-state.js'

export interface UnsavedGuardFace {
  confirm: ConfirmState | null
  /** 守卫包装：无未保存修改直接 proceed；否则弹确认框。 */
  guard(proceed: () => void): void
  /** 确认「保存并继续」（save 失败则不继续）。 */
  saveAndProceed(save: () => Promise<unknown>): Promise<void>
  /** 确认「放弃并继续」。 */
  discardAndProceed(): void
  /** 取消（关闭确认框）。 */
  cancel(): void
}

/** 未保存守卫面（confirm 状态在 state 内）。 */
export function useUnsavedGuard(state: StudioState, dispatch: Dispatch<StudioAction>): UnsavedGuardFace {
  const guard = useCallback((proceed: () => void) => {
    if (!state.dirty) {
      proceed()
      return
    }
    dispatch({ type: 'CONFIRM_SET', confirm: { kind: 'unsaved', proceed } })
  }, [dispatch, state.dirty])

  const saveAndProceed = useCallback(async (save: () => Promise<unknown>) => {
    const pending = state.confirm
    dispatch({ type: 'CONFIRM_SET', confirm: null })
    if (pending?.kind !== 'unsaved') return
    try {
      const saved = await save()
      if (saved !== null && saved !== undefined) pending.proceed?.()
    } catch {
      // 保存失败不继续（避免未保存数据被后续操作覆盖丢失）
    }
  }, [dispatch, state.confirm])

  const discardAndProceed = useCallback(() => {
    const pending = state.confirm
    dispatch({ type: 'CONFIRM_SET', confirm: null })
    if (pending?.kind === 'unsaved') pending.proceed?.()
  }, [dispatch, state.confirm])

  const cancel = useCallback(() => {
    dispatch({ type: 'CONFIRM_SET', confirm: null })
  }, [dispatch])

  return { confirm: state.confirm, guard, saveAndProceed, discardAndProceed, cancel }
}
