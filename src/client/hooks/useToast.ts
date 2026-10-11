// src/client/hooks/useToast.ts
//
// 轻提示：push（自动超时移除）/ 错误便捷入口。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction } from '../studio/studio-state.js'

/** 轻提示展示时长。 */
export const TOAST_DURATION_MS = 2600

export interface ToastFace {
  toast(kind: 'info' | 'success' | 'error', text: string): void
  toastError(error: unknown): void
}

/** 轻提示面（dispatch TOAST_PUSH/DROP；超时自动移除）。 */
export function useToast(dispatch: Dispatch<StudioAction>): ToastFace {
  // 未到期的自动移除定时器：卸载时逐个撤销，否则回调仍会向已卸载的宿主 dispatch
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current.clear()
  }, [])

  const toast = useCallback((kind: 'info' | 'success' | 'error', text: string) => {
    const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    dispatch({ type: 'TOAST_PUSH', toast: { id, kind, text } })
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      dispatch({ type: 'TOAST_DROP', id })
    }, TOAST_DURATION_MS)
    timers.current.add(timer)
  }, [dispatch])

  const toastError = useCallback((error: unknown) => {
    toast('error', error instanceof Error ? error.message : String(error))
  }, [toast])

  return { toast, toastError }
}
