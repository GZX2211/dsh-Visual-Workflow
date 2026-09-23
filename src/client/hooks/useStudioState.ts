// src/client/hooks/useStudioState.ts
//
// 工作台主状态机入口：useReducer 包装 + 派生快照。
// 初始化时恢复界面的「用户记忆」缓存（其余状态一律默认）：
//   - instance-options.ts：开启新会话/工作区路径；
//   - panel-layout.ts：面板几何与折叠态（刷新后回到上次布局）。
// 只在此处读一次（惰性初始化），不参与每次渲染。

import { useReducer } from 'react'
import { createInitialState, studioReducer, type StudioState } from '../studio/studio-state.js'
import { restoreInstanceOptions } from '../studio/instance-options.js'
import { restorePanels } from '../studio/panel-layout.js'

export interface StudioStateFace {
  state: StudioState
  dispatch: React.Dispatch<import('../studio/studio-state.js').StudioAction>
}

/** 初始状态工厂：默认状态 + 恢复用户记忆缓存（浏览器守卫；异常回退默认）。 */
function createInitialStateWithOptions(sessionId: string): StudioState {
  const initial = createInitialState(sessionId)
  if (typeof window === 'undefined') return initial
  const storage = window.localStorage
  return {
    ...initial,
    instanceOptions: restoreInstanceOptions(storage),
    panels: restorePanels(storage),
  }
}

/** 主状态机（会话绑定：初始 sessionId 注入，后续由 SET_SESSION 更新）。 */
export function useStudioState(sessionId: string): StudioStateFace {
  const [state, dispatch] = useReducer(studioReducer, sessionId, createInitialStateWithOptions)
  return { state, dispatch }
}