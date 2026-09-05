// src/client/hooks/useServiceControl.ts
//
// 模式二服务控制：列表加载 / 启动 / 停止 / 状态刷新（后端 P10 已就绪）。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { ServiceState } from '../../host/shared/types.js'
import type { WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { Drafted, StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

export interface ServiceControlFace {
  /** 加载服务实例列表（全部会话）；返回加载的条目。 */
  loadServices(): Promise<ServiceState[]>
  /** 新建本地服务草稿（_draft 标记；首次保存时经 putService 真实入库；目标会话 = 当前主会话）。 */
  createServiceDraft(name: string, sessionId: string): ServiceState
  /**
   * 模板 → 服务实例（图2 交互改造：模板拖入画布「创建服务」后转服务实例；深拷贝断引用）。
   * 目标会话由调用方决定（当前主会话 / 新建主会话）；「开启新会话/工作区」为一次性
   * 临时选项，不继承到实例文档（字段已退役）。
   */
  instantiateFromTemplate(template: WorkflowTemplate, targetSessionId: string): ServiceState
  /** 保存服务（草稿入库 / 正式带 revision 更新）。 */
  saveService(service: ServiceState, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<ServiceState | null>
  /** 启动服务：携带实例归属会话 id 供后端归属校验。 */
  startService(serviceId: string, sessionId: string): Promise<void>
  /** 停止服务：携带实例归属会话 id 供后端归属校验。 */
  stopService(serviceId: string, sessionId: string): Promise<void>
}

/** 服务控制面（远端失败抛错，由调用方 toast）。 */
export function useServiceControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): ServiceControlFace {
  /** 加载全部会话的服务实例列表（工作台全局化：不按当前会话过滤）。 */
  const loadServices = useCallback(async (): Promise<ServiceState[]> => {
    const items = await remote.call(EP.EP_LIST_SERVICES, {}) as unknown
    const list = Array.isArray(items) ? (items as ServiceState[]) : []
    dispatch({ type: 'SERVICES_LOADED', items: list })
    return list
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

  const instantiateFromTemplate = useCallback((template: WorkflowTemplate, targetSessionId: string): ServiceState => {
    const now = new Date().toISOString()
    const draft = {
      id: `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: targetSessionId,
      name: template.name ?? '未命名服务',
      description: template.description ?? '',
      revision: 0,
      nodes: JSON.parse(JSON.stringify(template.nodes ?? [])) as ServiceState['nodes'],
      lines: JSON.parse(JSON.stringify(template.lines ?? [])) as ServiceState['lines'],
      createdAt: now,
      updatedAt: now,
      status: 'stopped' as const,
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

  return { loadServices, createServiceDraft, instantiateFromTemplate, saveService, startService, stopService }
}
