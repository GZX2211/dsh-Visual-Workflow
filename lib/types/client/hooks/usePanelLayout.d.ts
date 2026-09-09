import type { Dispatch } from 'react';
import { type PanelLayout, type StudioAction, type StudioState } from '../studio/studio-state.js';
/** 面板默认/记忆几何。 */
export declare const LEFT_PANEL_DEFAULT = 236;
export declare const RIGHT_PANEL_DEFAULT = 300;
/** 宽度低于该值视为收起。 */
export declare const PANEL_COLLAPSE_THRESHOLD = 90;
/** localStorage 键（与旧项目一致，保留用户布局记忆）。 */
export declare const LAYOUT_KEYS: {
    readonly leftOpen: "visual-workflow:left-open";
    readonly rightOpen: "visual-workflow:right-open";
    readonly leftWidth: "visual-workflow:left-width";
    readonly rightWidth: "visual-workflow:right-width";
};
/** 读取持久化面板几何（组件初始化用）。 */
export declare function restorePanels(): PanelLayout;
export interface PanelLayoutFace {
    /** 开始拖宽（side: left/right；pointermove 期间更新几何与持久化）。 */
    beginResize(side: 'left' | 'right', event: {
        button?: number;
        clientX: number;
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
