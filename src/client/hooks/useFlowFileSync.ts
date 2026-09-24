// src/client/hooks/useFlowFileSync.ts
//
// 双向同步②「流程文件→画布」（图2 交互改造 + 用户裁决 q8）：
// 实例文件被外部修改（如经授权的代理编辑 workflows/<flowId>.json）后，画布
// 轮询检测 revision 变化并响应：
//   - 无未保存修改（dirty=false）：自动重载最新文档并刷新画布（防回环：只更新
//     文档/画布快照，不进撤销历史、不触保存）；
//   - 有未保存修改（dirty=true）：不自动覆盖，toast 提示「文件已被外部修改」
//     （用户可先保存/放弃后再刷新）。
// 轮询间隔对齐 runStatus（RUN_POLL_MS=600ms 非必须；此处用更保守的 2s，
// 降低空转；仅在打开工作流/服务实例时轮询）。
// 文案由调用方经 messages 注入（hook 不持有用户可见字符串）。

import { useRef } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { usePolling } from './usePolling.js'

/** 文件→画布同步轮询间隔（与 runStatus 轮询频率错开；2s 足够发现外部修改）。 */
export const FLOW_FILE_SYNC_MS = 2000

/** 外部修改提示文案（调用方从词典注入）。 */
export interface FlowFileSyncMessages {
  /** 工作流实例文件被外部修改。 */
  workflow: string
  /** 服务实例文件被外部修改。 */
  service: string
}

/** 最近已同步的外部 revision（防止同一次外部修改重复提示）。 */
interface AppliedRevision {
  kind: 'workflow' | 'service'
  id: string
  revision: number
  updatedAt: string
}

export function useFlowFileSync(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
  messages: FlowFileSyncMessages,
  onExternalChange?: (message: string) => void,
): void {
  // 记录最近一次「已应用」的外部 revision / updatedAt（本地保存亦会更新它）
  const appliedRef = useRef<AppliedRevision | null>(null)
  const kind = state.currentKind
  const id = state.currentId
  const enabled = (kind === 'workflow' || kind === 'service') && Boolean(id)

  usePolling(async ({ signal, timeoutMs, isCurrent }) => {
    if (kind === 'workflow') {
      const current = state.workflows.find((item) => item.id === id)
      if (!current) return
      // 工作台全局化：读取归属必须用实例绑定的会话（可能不是当前主会话）
      const doc = await remote.call(EP.EP_GET_WORKFLOW, { sessionId: current.sessionId, id }, { signal, timeoutMs }) as WorkflowDocument | null
      if (!isCurrent() || !doc) return
      const remoteRevision = Number(doc.revision ?? 0)
      // 本地已应用该版本（本地保存后 WORKFLOW_UPDATED 已同步）→ 跳过
      if (appliedRef.current?.kind === 'workflow' && appliedRef.current.id === id
        && appliedRef.current.revision === remoteRevision && appliedRef.current.updatedAt === doc.updatedAt) return
      if (remoteRevision <= Number(current.revision ?? 0)) return
      if (state.dirty) {
        // 有未保存修改：不覆盖，提示用户（一次性 per revision）
        if (appliedRef.current?.revision !== remoteRevision) {
          appliedRef.current = { kind: 'workflow', id: String(id), revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
          onExternalChange?.(messages.workflow)
        }
        return
      }
      // 无未保存修改：自动重载并刷新画布（打开文档语义；不进撤销栈）
      appliedRef.current = { kind: 'workflow', id: String(id), revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
      dispatch({ type: 'OPEN_FLOW', flow: doc })
      return
    }
    if (kind === 'service') {
      const current = state.services.find((item) => item.id === id)
      if (!current) return
      const doc = await remote.call(EP.EP_GET_SERVICE, { sessionId: current.sessionId, id }, { signal, timeoutMs }) as ServiceState | null
      if (!isCurrent() || !doc) return
      const remoteRevision = Number(doc.revision ?? 0)
      if (appliedRef.current?.kind === 'service' && appliedRef.current.id === id
        && appliedRef.current.revision === remoteRevision && appliedRef.current.updatedAt === doc.updatedAt) return
      if (remoteRevision <= Number(current.revision ?? 0)) return
      if (state.dirty) {
        if (appliedRef.current?.revision !== remoteRevision) {
          appliedRef.current = { kind: 'service', id: String(id), revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
          onExternalChange?.(messages.service)
        }
        return
      }
      appliedRef.current = { kind: 'service', id: String(id), revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
      dispatch({ type: 'OPEN_SERVICE', service: doc })
    }
    // 说明：task 经 ref 始终取最新渲染闭包（state.dirty 等无需进 deps），
    // deps 仅在「切换文档」时重建轮询；实例归属由实例自身会话承载。
  }, { intervalMs: FLOW_FILE_SYNC_MS, enabled }, [dispatch, remote, kind, id, messages.workflow, messages.service, onExternalChange])
}
