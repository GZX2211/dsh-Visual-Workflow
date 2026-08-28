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

import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowDocument } from '../../host/shared/graph-model.js'
import type { ServiceState } from '../../host/shared/types.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'

/** 文件→画布同步轮询间隔（与 runStatus 轮询频率错开；2s 足够发现外部修改）。 */
export const FLOW_FILE_SYNC_MS = 2000

/** 最近已同步的外部 revision（防止同一次外部修改重复提示）。 */
export function useFlowFileSync(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  remote: RemoteFace,
  onExternalChange?: (message: string) => void,
): void {
  // 记录最近一次「已应用」的外部 revision / updatedAt（本地保存亦会更新它）
  const appliedRef = useRef<{ kind: 'workflow' | 'service'; id: string; revision: number; updatedAt: string } | null>(null)

  useEffect(() => {
    const kind = state.currentKind
    if (kind !== 'workflow' && kind !== 'service') return undefined
    const id = state.currentId
    if (!id) return undefined
    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        if (kind === 'workflow') {
          const doc = await remote.call(EP.EP_GET_WORKFLOW, { sessionId: state.sessionId, id }) as WorkflowDocument | null
          if (cancelled || !doc) return
          const current = state.workflows.find((item) => item.id === id)
          if (!current) return
          const remoteRevision = Number(doc.revision ?? 0)
          // 本地已应用该版本（本地保存后 WORKFLOW_UPDATED 已同步）→ 跳过
          if (appliedRef.current?.kind === 'workflow' && appliedRef.current.id === id
            && appliedRef.current.revision === remoteRevision && appliedRef.current.updatedAt === doc.updatedAt) return
          if (remoteRevision <= Number(current.revision ?? 0)) return
          if (state.dirty) {
            // 有未保存修改：不覆盖，提示用户（一次性 per revision）
            if (appliedRef.current?.revision !== remoteRevision) {
              appliedRef.current = { kind, id, revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
              onExternalChange?.('实例文件已被外部修改，请先保存或放弃当前修改后再刷新')
            }
            return
          }
          // 无未保存修改：自动重载并刷新画布（打开文档语义；不进撤销栈）
          appliedRef.current = { kind, id, revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
          dispatch({ type: 'OPEN_FLOW', flow: doc })
        } else {
          const doc = await remote.call(EP.EP_GET_SERVICE, { sessionId: state.sessionId, id }) as ServiceState | null
          if (cancelled || !doc) return
          const current = state.services.find((item) => item.id === id)
          if (!current) return
          const remoteRevision = Number(doc.revision ?? 0)
          if (appliedRef.current?.kind === 'service' && appliedRef.current.id === id
            && appliedRef.current.revision === remoteRevision && appliedRef.current.updatedAt === doc.updatedAt) return
          if (remoteRevision <= Number(current.revision ?? 0)) return
          if (state.dirty) {
            if (appliedRef.current?.revision !== remoteRevision) {
              appliedRef.current = { kind, id, revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
              onExternalChange?.('服务文件已被外部修改，请先保存或放弃当前修改后再刷新')
            }
            return
          }
          appliedRef.current = { kind, id, revision: remoteRevision, updatedAt: doc.updatedAt ?? '' }
          dispatch({ type: 'OPEN_SERVICE', service: doc })
        }
      } catch {
        // 轮询偶发失败下一轮重试（瞬态网络错误不打扰用户）
      }
    }

    void poll()
    const timer = setInterval(() => { void poll() }, FLOW_FILE_SYNC_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // state.dirty 等快照必须在每次轮询引用当前值——依赖数组仅 key 变化时重建定时器，
    // dirty 状态经 ref 保持最新。为正确性，deps 含 dirty：重建定时器成本可接受。
  }, [dispatch, remote, state.sessionId, state.currentKind, state.currentId, state.dirty, onExternalChange])
}
