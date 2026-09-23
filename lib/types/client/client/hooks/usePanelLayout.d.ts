import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
export interface PanelLayoutFace {
    /** 开始拖宽/拖高（side: left/right/bottom；pointermove 期间更新几何与持久化）。 */
    beginResize(side: 'left' | 'right' | 'bottom', event: {
        button?: number;
        clientX: number;
        clientY: number;
        preventDefault?(): void;
        currentTarget?: {
            classList?: {
                add(name: string): void;
                remove(name: string): void;
            };
        };
    }): void;
}
/** 面板几何面（当前几何在 state.panels；拖宽过程 dispatch PANELS_SET）。 */
export declare function usePanelLayout(state: StudioState, dispatch: Dispatch<StudioAction>): PanelLayoutFace;
