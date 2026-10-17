// src/client/hooks/useKeyShortcuts.ts
//
// 键盘快捷键：Escape 关闭确认框/清空选中；Ctrl/Cmd+Z 撤销（Shift 重做）；
// Delete 删除选中连线/节点（输入控件聚焦时跳过）。

import { useEffect } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { SelectionFace } from './useSelection.js'
import type { GraphHistoryFace } from './useGraphHistory.js'
import type { CanvasActionsFace } from './useCanvasActions.js'

/** 键盘快捷键监听（window 级；卸载时移除）。 */
export function useKeyShortcuts(
  state: StudioState,
  dispatch: Dispatch<StudioAction>,
  selection: SelectionFace,
  history: GraphHistoryFace,
  removeLine: CanvasActionsFace['removeLine'],
  removeSelected: CanvasActionsFace['removeSelected'],
): void {
  // 依赖只列处理函数真正读取的事实（确认框有无、选中连线/节点 id）：
  // 用整个 state 或 selection 对象会让无关状态变化也重挂 window 监听（D08-07）。
  const hasConfirm = state.confirm !== null
  const selectedEdgeId = state.selection.edgeId
  const selectedNodeId = state.selection.nodeId
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (hasConfirm) dispatch({ type: 'CONFIRM_SET', confirm: null })
        else selection.clearSelection()
        return
      }
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      if (typing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
      } else if (event.key === 'Delete') {
        if (selectedEdgeId) {
          event.preventDefault()
          removeLine(selectedEdgeId)
        } else if (selectedNodeId) {
          event.preventDefault()
          removeSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch, hasConfirm, history, removeLine, removeSelected, selectedEdgeId, selectedNodeId, selection])
}
