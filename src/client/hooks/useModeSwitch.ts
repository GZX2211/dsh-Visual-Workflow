// src/client/hooks/useModeSwitch.ts
//
// 模式切换（mode1 编排执行 / mode2 后台服务）：状态级切换动作；
// 未保存守卫与工作流持久化由调用方组合（T-046 完整切换流程）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'

export interface ModeSwitchFace {
  setMode(mode: 'mode1' | 'mode2'): void
}

/** 模式切换面（dispatch SET_MODE）。 */
export function useModeSwitch(dispatch: Dispatch<StudioAction>): ModeSwitchFace {
  const setMode = useCallback((mode: 'mode1' | 'mode2') => {
    dispatch({ type: 'SET_MODE', mode })
  }, [dispatch])
  return { setMode }
}
