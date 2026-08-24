// src/client/hooks/useStudioState.ts
//
// 工作台主状态机入口：useReducer 包装 + 派生快照。

import { useReducer } from 'react'
import { createInitialState, studioReducer, type StudioState } from '../studio/studio-state.js'

export interface StudioStateFace {
  state: StudioState
  dispatch: React.Dispatch<import('../studio/studio-state.js').StudioAction>
}

/** 主状态机（会话绑定：初始 sessionId 注入，后续由 SET_SESSION 更新）。 */
export function useStudioState(sessionId: string): StudioStateFace {
  const [state, dispatch] = useReducer(studioReducer, sessionId, createInitialState)
  return { state, dispatch }
}
