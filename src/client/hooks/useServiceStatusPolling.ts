// src/client/hooks/useServiceStatusPolling.ts
//
// 模式二服务运行状态轮询（补齐事实投影缺口）：
// 服务进程在宿主侧可能自行崩溃或被回收（Host 会把文档标记 crashed/stopped），
// 而客户端不参与该状态变化、也收不到事件——此前只有启动/停止动作才会刷新状态，
// 服务崩溃后界面会一直显示「运行中」。此轮询把宿主的运行事实拉回投影。
//
// 范围与代价控制：
//   - 仅模式二、且存在「非 stopped」服务实例时轮询（通常 0~2 个）；
//   - 只在 status/port 真变化时 dispatch（无变化零状态更新、零重渲染）；
//   - 单轮失败静默（服务列表可用性不受影响），并发/序号/取消由 usePolling 承担。

import { useMemo } from 'react'
import type { Dispatch } from 'react'
import type { ServiceState } from '../../host/shared/types.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { usePolling } from './usePolling.js'

/** 服务状态轮询间隔（与活跃 run 徽标同频；服务状态变化频率低）。 */
export const SERVICE_STATUS_POLL_MS = 2_000

/**
 * 需要跟踪的服务实例（非 stopped；停止态无进程可查，且崩溃恢复由启动动作驱动）。
 * 纯函数，便于单测。
 */
export function trackedServicesOf(services: readonly ServiceState[]): ServiceState[] {
  return (services ?? []).filter((service) => service.status !== 'stopped')
}

/** 跟踪签名（id + status + port）：签名变化即重建轮询（新增/移除服务或状态跳变）。 */
export function trackedServicesSignature(services: readonly ServiceState[]): string {
  return trackedServicesOf(services)
    .map((service) => `${service.id}:${String(service.status)}:${String(service.port ?? '')}`)
    .sort()
    .join('|')
}

export function useServiceStatusPolling(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
): void {
  const mode = state.mode
  // 签名只在「跟踪集合或状态跳变」时变化：状态由本 hook 自身更新时签名随之一致，
  // 不会造成无休止重建（重建后第一轮即为最新值）。
  const signature = useMemo(() => trackedServicesSignature(state.services), [state.services])

  usePolling(async ({ signal, timeoutMs, isCurrent }) => {
    const targets = trackedServicesOf(state.services)
    if (targets.length === 0) return
    const results = await Promise.all(targets.map((service) => remote.call(
      EP.EP_SERVICE_STATUS,
      { sessionId: service.sessionId, serviceId: service.id },
      { signal, timeoutMs },
    ).catch(() => null)))
    if (!isCurrent()) return
    for (const result of results) {
      const service = result as ServiceState | null
      if (!service?.id) continue
      const known = targets.find((item) => item.id === service.id)
      if (!known) continue
      // 仅状态/端口真变化时落库，避免每轮都重渲染
      if (known.status === service.status && known.port === service.port) continue
      dispatch({ type: 'SERVICE_UPDATED', service })
    }
    // 说明：task 经 ref 取最新渲染闭包（state.services 始终最新）；deps 中的 signature
    // 只在跟踪集合/状态跳变时重建轮询，避免每轮重建。
  }, { intervalMs: SERVICE_STATUS_POLL_MS, enabled: mode === 'mode2' && signature !== '' }, [dispatch, mode, remote, signature])
}
