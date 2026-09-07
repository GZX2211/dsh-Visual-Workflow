// src/client/hooks/useStudioState.ts
//
// 工作台主状态机入口：useReducer 包装 + 派生快照。
// 初始化时恢复「开启新会话」/工作区路径缓存（instance-options.ts），
// 其余状态一律默认（首进即默认画布与布局，符合用户裁决）。

import { useReducer } from 'react'
import { createInitialState, studioReducer, type StudioState } from '../studio/studio-state.js'
import { restoreInstanceOptions } from '../studio/instance-options.js'

export interface StudioStateFace {
  state: StudioState
  dispatch: React.Dispatch<import('../studio/studio-state.js').StudioAction>
}

/** 初始状态工厂：默认状态 + 恢复 instanceOptions 缓存（浏览器守卫；异常回退默认）。 */
function createInitialStateWithOptions(sessionId: string): StudioState {
  const initial = createInitialState(sessionId)
  if (typeof window === 'undefined') return initial
  return { ...initial, instanceOptions: restoreInstanceOptions(window.localStorage) }
}

/** 主状态机（会话绑定：初始 sessionId 注入，后续由 SET_SESSION 更新）。 */
export function useStudioState(sessionId: string): StudioStateFace {
  const [state, dispatch] = useReducer(studioReducer, sessionId, createInitialStateWithOptions)
  return { state, dispatch }
}