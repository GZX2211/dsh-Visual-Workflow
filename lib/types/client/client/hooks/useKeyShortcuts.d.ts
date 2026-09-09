import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { SelectionFace } from './useSelection.js';
import type { GraphHistoryFace } from './useGraphHistory.js';
import type { CanvasActionsFace } from './useCanvasActions.js';
/** 键盘快捷键监听（window 级；卸载时移除）。 */
export declare function useKeyShortcuts(state: StudioState, dispatch: Dispatch<StudioAction>, selection: SelectionFace, history: GraphHistoryFace, removeLine: CanvasActionsFace['removeLine'], removeSelected: CanvasActionsFace['removeSelected']): void;
