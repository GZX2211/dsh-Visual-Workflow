// src/client/hooks/useKeyShortcuts.ts
//
// 键盘快捷键：Escape 关闭确认框/清空选中；Ctrl/Cmd+Z 撤销（Shift 重做）；
// Delete/Backspace 删除选中连线/节点（输入控件聚焦时跳过）。

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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (state.confirm) dispatch({ type: 'CONFIRM_SET', confirm: null })
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
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selection.edgeId) {
          event.preventDefault()
          removeLine(state.selection.edgeId)
        } else if (state.selection.nodeId) {
          event.preventDefault()
          removeSelected()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch, history, removeLine, removeSelected, selection, state.confirm, state.selection])
}
