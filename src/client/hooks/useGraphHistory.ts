// src/client/hooks/useGraphHistory.ts
//
// 画布撤销/重做：变更前 remember 入栈；undo/redo 恢复图快照（上限 60）。

import { useCallback, useMemo, useRef } from 'react'
import type { Dispatch } from 'react'
import { graphSnapshotOf, type StudioAction, type StudioState } from '../studio/studio-state.js'

export interface GraphHistoryFace {
  remember(): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
}

/** 图历史面（remember 需在变更 dispatch 前调用）。 */
export function useGraphHistory(state: StudioState, dispatch: Dispatch<StudioAction>): GraphHistoryFace {
  // remember 读 state 的最新画布：经 ref 取当前渲染的 state，回调身份因此跨渲染固定
  // （face 是 effect/监听依赖，身份不稳会让监听反复重挂，D08-07）；语义上也更严格——
  // 即便调用方持有旧回调，入栈的快照也是调用时刻的画布。
  const stateRef = useRef(state)
  stateRef.current = state

  const remember = useCallback(() => {
    dispatch({ type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(stateRef.current) })
  }, [dispatch])

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [dispatch])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [dispatch])

  const canUndo = state.history.past.length > 0
  const canRedo = state.history.future.length > 0
  return useMemo(() => ({ remember, undo, redo, canUndo, canRedo }), [canRedo, canUndo, redo, remember, undo])
}
