// src/client/hooks/useAutoLayout.ts
//
// 自动布局接线（自主编排方案 §7.3 / 决策 D-15 方案 B、P0-A2）：
//   - 打开/接收文档时若存在**缺坐标或哨兵坐标 {0,0}** 的节点 → 用新分层布局自动重排一次，
//     并立即静默落盘（几何改动不算编排变更，不会触发【编排变更】注入）；
//   - 文档已布局过（无哨兵坐标）→ 不做任何事，绝不覆盖用户手动调整；
//   - 检测到节点矩形重叠 → 非阻断提示「建议整理布局」（不自动重排，尊重用户当前布局）。
//
// 职责边界：本 hook 只负责「判定 + 触发 + 落盘 + 提示」，
// 布局算法在 lib/layout.ts、判定与几何工具在 lib/layout-fit.ts（纯函数、可单测）。

import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { CanvasNode, StudioAction, StudioState } from '../studio/studio-state.js'
import type { CanvasLine } from '../lib/graph-model.js'
import { applyLayout, collapsedIdsOf, findLayoutOverlaps, layoutBoxesOf, needsAutoLayout } from '../lib/layout-fit.js'
import { layoutGraph, toLayoutInputs } from '../lib/layout.js'
import { groupCardSizeOf } from '../components/canvas/geometry.js'

/** 自动布局钩子依赖（全部可选注入，便于单测与「能力缺失即降级」）。 */
export interface AutoLayoutOptions {
  /** 画布保存入口（静默落盘；缺省则只更新本地画布，不落盘）。 */
  saveCanvas?: (options?: { auto?: boolean }) => Promise<unknown> | void
  /** 轻提示（重叠提示用；缺省静默）。 */
  notify?: (kind: 'info' | 'success' | 'error', text: string) => void
  /** 提示文案（词典缺省时用内置中文）。 */
  tips?: { overlap?: string }
  /** 布局完成后的视图回调（如自动适配视图；缺省不调用）。 */
  onApplied?: (nodes: CanvasNode[]) => void
}

/**
 * 自动布局接线（每个「当前文档 id」只尝试一次；失败不阻断编辑）。
 * 与 tidyGraph 共用同一布局入口（lib/layout.ts），保证两条路径结果一致。
 */
export function useAutoLayout(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  options: AutoLayoutOptions = {},
): void {
  /** 已尝试过自动布局的文档 key（id:kind）；重开同一文档不再重复尝试。 */
  const attemptedRef = useRef<string>('')
  /** 回调经 ref 转发，避免因 options 对象每次渲染变化而重复触发副作用。 */
  const optionsRef = useRef(options)
  optionsRef.current = options

  const { currentId, currentKind, canvas } = state
  useEffect(() => {
    if (!currentId || !currentKind) return
    const key = `${currentKind}:${currentId}`
    if (attemptedRef.current === key) return
    const nodes = canvas.nodes as unknown as CanvasNode[]
    if (nodes.length === 0) return
    attemptedRef.current = key

    // ① 缺坐标/哨兵坐标 → 自动重排一次并立即落盘
    if (needsAutoLayout(nodes as never)) {
      const inputs = toLayoutInputs(
        nodes as unknown as Array<{ id: string; kind: string; data?: Record<string, unknown> }>,
        (node) => groupCardSizeOf(node as never),
      )
      const result = layoutGraph(inputs, canvas.edges as unknown as CanvasLine[])
      const next = applyLayout(nodes as never, result) as unknown as CanvasNode[]
      dispatch({ type: 'GRAPH_REPLACED', nodes: next, edges: canvas.edges, dirty: true })
      void Promise.resolve(optionsRef.current.saveCanvas?.({ auto: true })).catch(() => {
        // 自动落盘失败不阻断编辑（用户仍可手动保存；既有保存路径负责报错提示）
      })
      optionsRef.current.onApplied?.(next)
      return
    }

    // ② 已布局：只检测重叠并提示（非阻断，不自动重排）
    // 排除「重复渲染」的节点（组内成员写入组卡片内、虚拟节点与主节点同坐标）：否则会永远告警
    const inputs = toLayoutInputs(
      nodes as unknown as Array<{ id: string; kind: string; data?: Record<string, unknown> }>,
      (node) => groupCardSizeOf(node as never),
    )
    const excluded = collapsedIdsOf(inputs)
    const boxes = layoutBoxesOf(nodes as never, (node) => groupCardSizeOf(node as never), excluded)
    if (findLayoutOverlaps(boxes).length === 0) return
    optionsRef.current.notify?.('info', optionsRef.current.tips?.overlap ?? '画布存在重叠节点，建议点击「整理布局」')
  }, [currentId, currentKind, canvas.nodes, canvas.edges, dispatch])
}
