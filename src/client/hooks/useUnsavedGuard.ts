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
  /**
   * 确认「保存并继续」：真实保存完成后才继续原操作。
   * @param save 保存执行体：必须把「真实落库成功」的回调（onSaved）接到自己的保存链上
   *   ——需要二次确认的路径（运行中实例保存）本次调用只返回 null，其落库发生在用户确认之后，
   *   由 onSaved 转达；未落库（待确认/失败/取消）一律不继续，dirty 保留。
   */
  saveAndProceed(save: (onSaved: () => void) => Promise<unknown>): Promise<void>
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

  const saveAndProceed = useCallback(async (save: (onSaved: () => void) => Promise<unknown>) => {
    const pending = state.confirm
    dispatch({ type: 'CONFIRM_SET', confirm: null })
    if (pending?.kind !== 'unsaved') return
    /** 原操作只允许继续一次（即时路径与确认路径可能先后都报到）。 */
    let proceeded = false
    const proceed = (): void => {
      if (proceeded) return
      proceeded = true
      pending.proceed?.()
    }
    try {
      // 返回值非 null/undefined = 本次调用已真实落库，直接继续；
      // 返回 null = 本次调用没有落库（运行中保存需二次确认 / 保存失败）——
      // 此时不继续、不静默丢弃：待用户确认后由 save 内部经 onSaved 接续，
      // 取消或失败则保持 dirty（原操作不执行，用户数据不丢）。
      const saved = await save(proceed)
      if (saved !== null && saved !== undefined) proceed()
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
