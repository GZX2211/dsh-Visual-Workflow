import type { ReactNode } from 'react';
import type { Dict } from '../i18n.js';
/** 窗口几何（像素；x/y 为窗口左上角）。 */
export interface WindowBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 默认几何（视口右下偏上居中）。 */
export declare const DEFAULT_WINDOW_BOUNDS: WindowBounds;
/** 最小窗口尺寸。 */
export declare const MIN_WINDOW_WIDTH = 480;
export declare const MIN_WINDOW_HEIGHT = 320;
/** 几何持久化键。 */
export declare const WINDOW_BOUNDS_KEY = "visual-workflow:window-bounds";
/** 缩放方向（四边/四角）。 */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface FloatingWindowProps {
    /** 文案词典。 */
    t: Dict;
    /** 窗口内容（工作台）。 */
    children: ReactNode;
}
/**
 * FAB + 浮窗宿主：FAB 固定右下角；打开后渲染可拖动/可缩放的窗口。
 * 几何状态本地管理（与工作台状态机解耦），持久化记忆。
 */
export declare function FloatingWindow({ t, children }: FloatingWindowProps): import("react").JSX.Element;
