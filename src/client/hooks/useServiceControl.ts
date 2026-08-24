// src/client/hooks/useServiceControl.ts
//
// 模式二服务控制：列表加载 / 启动 / 停止 / 状态刷新（后端 P10 已就绪）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { ServiceState } from '../../host/shared/types.js'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface ServiceControlFace {
  loadServices(sessionId: string): Promise<void>
  startService(serviceId: string): Promise<void>
  stopService(serviceId: string): Promise<void>
}

/** 服务控制面（远端失败抛错，由调用方 toast）。 */
export function useServiceControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): ServiceControlFace {
  const loadServices = useCallback(async (sessionId: string) => {
    const items = await remote.call(EP.EP_LIST_SERVICES, { sessionId })
    dispatch({ type: 'SERVICES_LOADED', items: Array.isArray(items) ? (items as ServiceState[]) : [] })
  }, [dispatch, remote])

  const startService = useCallback(async (serviceId: string) => {
    const service = await remote.call(EP.EP_SERVICE_START, { serviceId }) as ServiceState
    dispatch({ type: 'SERVICE_UPDATED', service })
  }, [dispatch, remote])

  const stopService = useCallback(async (serviceId: string) => {
    const service = await remote.call(EP.EP_SERVICE_STOP, { serviceId }) as ServiceState
    dispatch({ type: 'SERVICE_UPDATED', service })
  }, [dispatch, remote])

  return { loadServices, startService, stopService }
}
