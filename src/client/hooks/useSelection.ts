// src/client/hooks/useSelection.ts
//
// 选中与编辑器面：画布节点/连线/左侧库卡片/编辑器引用。

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { StudioAction, LibTab, EditorRef } from '../studio/studio-state.js'

export interface SelectionFace {
  selectNode(id: string): void
  selectEdge(id: string): void
  selectLib(kind: LibTab, id: string): void
  selectEditor(editor: EditorRef): void
  clearSelection(): void
}

/** 选中与编辑器面（dispatch 直通）。 */
export function useSelection(dispatch: Dispatch<StudioAction>): SelectionFace {
  const selectNode = useCallback((id: string) => dispatch({ type: 'SELECT_NODE', id }), [dispatch])
  const selectEdge = useCallback((id: string) => dispatch({ type: 'SELECT_EDGE', id }), [dispatch])
  const selectLib = useCallback((kind: LibTab, id: string) => dispatch({ type: 'SELECT_LIB', kind, id }), [dispatch])
  const selectEditor = useCallback((editor: EditorRef) => dispatch({ type: 'SELECT_EDITOR', editor }), [dispatch])
  const clearSelection = useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), [dispatch])
  return { selectNode, selectEdge, selectLib, selectEditor, clearSelection }
}
