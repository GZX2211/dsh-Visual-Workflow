// src/client/hooks/useGraphHistory.ts
//
// 画布撤销/重做：变更前 remember 入栈；undo/redo 恢复图快照（上限 60）。

import { useCallback } from 'react'
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
  const remember = useCallback(() => {
    dispatch({ type: 'HISTORY_PUSH', snapshot: graphSnapshotOf(state) })
  }, [dispatch, state])

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [dispatch])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [dispatch])

  return { remember, undo, redo, canUndo: state.history.past.length > 0, canRedo: state.history.future.length > 0 }
}
