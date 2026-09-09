import type { Dispatch } from 'react';
import { type PanelLayout, type StudioAction, type StudioState } from '../studio/studio-state.js';
/** 面板默认/记忆几何。 */
export declare const LEFT_PANEL_DEFAULT = 230;
export declare const RIGHT_PANEL_DEFAULT = 230;
export declare const BOTTOM_PANEL_DEFAULT = 170;
/** localStorage 键（与旧项目兼容的左右宽度沿用；新增 mode/bottom-height）。 */
export declare const LAYOUT_KEYS: {
    readonly mode: "visual-workflow:panel-mode";
    readonly leftWidth: "visual-workflow:left-width";
    readonly rightWidth: "visual-workflow:right-width";
    readonly bottomHeight: "visual-workflow:bottom-height";
};
/** 读取持久化面板几何（组件初始化用）。 */
export declare function restorePanels(): PanelLayout;
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
