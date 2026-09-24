// src/client/hooks/useFlowTemplatesPolling.ts
//
// 工作流模板列表轮询（P2 自主编排）：模板是**全局共享**资产，除了用户在画布上保存，
// 还可能被**父代理**在宿主侧经 wf_graph_patch（scope='template' + create/更新）改写——
// 客户端不参与那次写入、也收不到事件，因此需要轻量轮询把「代理产出的模板」拉进左侧
// 模板列表；否则规划结果要刷新页面才可见。
//
// 与 useFlowFileSync（当前打开实例的「文件→画布」同步）互补：本 hook 只维护**列表**，
// 不碰当前画布与撤销栈；仅在「签名（id + revision + updatedAt）」变化时 dispatch，
// 无变化不产生任何 reducer 更新。本地未落盘的模板草稿由 reducer 的
// FLOW_TEMPLATES_SYNCED 分支保留（服务端列表里没有它们）。

import { useRef } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowTemplate } from '../../host/shared/graph-model.js'
import type { StudioAction } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import { EP } from '../lib/remote.js'
import { usePolling } from './usePolling.js'

/** 模板列表轮询间隔（模板变更频率低；比活跃 run 的 2s 慢，降低空转）。 */
export const FLOW_TEMPLATES_POLL_MS = 5_000

/**
 * 服务端模板列表签名（id + revision + updatedAt，排序后拼接）。
 * 用途：无变化时跳过 dispatch，避免每轮都替换列表数组触发无谓重渲染。
 * 纯函数，便于单测。
 */
export function flowTemplatesSignature(items: readonly WorkflowTemplate[]): string {
  return (items ?? [])
    .map((item) => String(item.id) + ':' + (Number(item.revision) || 0) + ':' + String(item.updatedAt ?? ''))
    .sort()
    .join('|')
}

/** 轮询 effect：挂载即拉一次，随后定时拉取；仅签名变化时 dispatch。 */
export function useFlowTemplatesPolling(dispatch: Dispatch<StudioAction>, remote: RemoteFace): void {
  const lastSignature = useRef<string | null>(null)
  usePolling(async ({ signal, timeoutMs, isCurrent }) => {
    const items = await remote.call(EP.EP_LIST_FLOW_TEMPLATES, {}, { signal, timeoutMs })
    if (!isCurrent()) return
    const list = Array.isArray(items) ? (items as WorkflowTemplate[]) : []
    const signature = flowTemplatesSignature(list)
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    dispatch({ type: 'FLOW_TEMPLATES_SYNCED', items: list })
  }, { intervalMs: FLOW_TEMPLATES_POLL_MS }, [dispatch, remote])
}
