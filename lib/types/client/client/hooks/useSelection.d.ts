import type { Dispatch } from 'react';
import type { StudioAction, EditorRef, LibSelKind } from '../studio/studio-state.js';
export interface SelectionFace {
    selectNode(id: string): void;
    selectEdge(id: string): void;
    selectLib(kind: LibSelKind, id: string): void;
    selectEditor(editor: EditorRef): void;
    clearSelection(): void;
}
/** 选中与编辑器面（dispatch 直通）。 */
export declare function useSelection(dispatch: Dispatch<StudioAction>): SelectionFace;
