import type { Dispatch } from 'react';
import { type StudioAction, type StudioState } from '../studio/studio-state.js';
export interface GraphHistoryFace {
    remember(): void;
    undo(): void;
    redo(): void;
    canUndo: boolean;
    canRedo: boolean;
}
/** 图历史面（remember 需在变更 dispatch 前调用）。 */
export declare function useGraphHistory(state: StudioState, dispatch: Dispatch<StudioAction>): GraphHistoryFace;
