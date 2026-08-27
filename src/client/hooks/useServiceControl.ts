// src/client/hooks/useServiceControl.ts
//
// 模式二服务控制：列表加载 / 启动 / 停止 / 状态刷新（后端 P10 已就绪）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { ServiceState } from '../../host/shared/types.js'
import type { Drafted, StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface ServiceControlFace {
  loadServices(sessionId: string): Promise<void>
  /** 新建本地服务草稿（_draft 标记；首次保存时经 putService 真实入库）。 */
  createServiceDraft(name: string, sessionId: string): ServiceState
  /** 保存服务（草稿入库 / 正式带 revision 更新）。 */
  saveService(service: ServiceState, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<ServiceState | null>
  /** 启动服务：携带会话 id 供后端归属校验。 */
  startService(serviceId: string, sessionId: string): Promise<void>
  /** 停止服务：携带会话 id 供后端归属校验。 */
  stopService(serviceId: string, sessionId: string): Promise<void>
}

/** 服务控制面（远端失败抛错，由调用方 toast）。 */
export function useServiceControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): ServiceControlFace {
  const loadServices = useCallback(async (sessionId: string) => {
    // 会话未激活时跳过（后端 requires sessionId 400）
    if (!sessionId) {
      dispatch({ type: 'SERVICES_LOADED', items: [] })
      return
    }
    const items = await remote.call(EP.EP_LIST_SERVICES, { sessionId })
    dispatch({ type: 'SERVICES_LOADED', items: Array.isArray(items) ? (items as ServiceState[]) : [] })
  }, [dispatch, remote])

  const createServiceDraft = useCallback((name: string, sessionId: string): ServiceState => {
    const now = new Date().toISOString()
    const draft = {
      id: `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      name,
      description: '',
      revision: 0,
      nodes: [],
      lines: [],
      createdAt: now,
      updatedAt: now,
      status: 'stopped' as const,
      // 草稿标记（前端 UI 状态；后端 putService 经 stripClientMeta 剥除，绝不落盘）
      _draft: true,
    } as Drafted<ServiceState>
    dispatch({ type: 'OPEN_SERVICE', service: draft })
    return draft
  }, [dispatch])

  const saveService = useCallback(async (service: ServiceState, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<ServiceState | null> => {
    const serialized = {
      ...service,
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        position: node.position,
        data: node.data,
        // 虚拟节点顶层 proxySourceId 保留（Bug 2）
        ...((node as { proxySourceId?: unknown }).proxySourceId !== undefined
          ? { proxySourceId: (node as { proxySourceId?: string }).proxySourceId }
          : {}),
      })) as ServiceState['nodes'],
      lines: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        ...(edge.condition ? { condition: edge.condition } : {}),
      })),
    }
    const saved = await remote.call(EP.EP_PUT_SERVICE, {
      sessionId: service.sessionId,
      service: serialized,
    }) as ServiceState
    dispatch({ type: 'SERVICE_UPDATED', service: saved })
    return saved
  }, [dispatch, remote])

  const startService = useCallback(async (serviceId: string, sessionId: string) => {
    const service = await remote.call(EP.EP_SERVICE_START, { sessionId, serviceId }) as ServiceState
    dispatch({ type: 'SERVICE_UPDATED', service })
  }, [dispatch, remote])

  const stopService = useCallback(async (serviceId: string, sessionId: string) => {
    const service = await remote.call(EP.EP_SERVICE_STOP, { sessionId, serviceId }) as ServiceState
    dispatch({ type: 'SERVICE_UPDATED', service })
  }, [dispatch, remote])

  return { loadServices, createServiceDraft, saveService, startService, stopService }
}
