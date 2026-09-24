// src/client/lib/dom-hit-test.ts
//
// 画布 DOM 命中检测（纯 DOM 计算，与渲染几何分离）：
// 节点/协作组表面的 elementFromPoint 命中判定。被组件（GraphCanvas、
// FlowNode 落点）与 hook（useLibraryDrag 左栏拖拽）共用，故归 lib——
// 归属判定只依赖 DOM 契约（data-wf-node-id / wf-group-node 类名），
// 不依赖任何 UI 模块，也不读取界面状态。

/** 命中检测：鼠标坐标下的节点 id（最近 data-wf-node-id 祖先）。
 *  环境不提供 elementFromPoint 时返回 null（降级不抛错，与 groupSurfaceUnderPoint 一致）。 */
export function connectionTargetAt(clientX: number, clientY: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null
  const element = document.elementFromPoint(clientX, clientY)
  return element?.closest?.('[data-wf-node-id]')?.getAttribute('data-wf-node-id') ?? null
}

/**
 * 协作组表面命中（入组判定，用户批注 §4.2.5.2 收紧：仅组卡片表面可入组）：
 *  - 跳过不在协作组内的元素（画布空白/连线 SVG/其他节点等装饰层）；
 *  - 跳过被拖拽本体节点（拖拽时节点被挪到鼠标下方，若不排除会遮蔽组表面命中）；
 *  - 命中 `.wf-graph__handle`（连接点）→ 返回 null：连接点**不具入组功能**。
 * 返回命中的协作组 id；否则 null。纯函数接收元素数组，便于 jsdom 单测。
 */
export function groupSurfaceFromElements(elements: Element[], excludeNodeId?: string | null): string | null {
  for (const el of elements) {
    const groupEl = el.closest?.('.wf-group-node') as HTMLElement | null
    if (!groupEl) continue
    const hostNodeId = el.closest?.('[data-wf-node-id]')?.getAttribute('data-wf-node-id') ?? null
    if (excludeNodeId && hostNodeId === excludeNodeId) continue
    if (el.closest?.('.wf-graph__handle')) return null
    return groupEl.getAttribute('data-wf-node-id')
  }
  return null
}

/** 鼠标坐标下的协作组表面（入组落点；封装 elementsFromPoint，供拖拽 onMove/onUp 共用）。 */
export function groupSurfaceUnderPoint(clientX: number, clientY: number, excludeNodeId?: string | null): string | null {
  if (typeof document.elementsFromPoint !== 'function') return null
  return groupSurfaceFromElements(document.elementsFromPoint(clientX, clientY), excludeNodeId)
}
