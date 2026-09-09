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
/** 恢复记忆几何（损坏/越界回退默认；导出供 WorkbenchFrame 复用）。 */
export declare function restoreBounds(): WindowBounds;
declare function keepBounds(bounds: WindowBounds): void;
export { keepBounds };
/** 缩放方向（四边/四角）。 */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface FloatingWindowProps {
    /** 文案词典。 */
    t: Dict;
    /** 窗口是否打开（受控；由宿主 WorkbenchHost 决定）。 */
    open: boolean;
    /** 关闭回调（受控；由宿主关闭工作台）。 */
    onClose: () => void;
    /** 窗口内容（工作台）；close 关闭窗口、drag 把拖动把手挂到内容标题栏。 */
    children: (api: {
        close(): void;
        drag(event: DragEventLike): void;
    }) => ReactNode;
}
/** beginDrag/beginResize 事件最小形状（React 合成 PointerEvent 满足）。 */
export interface DragEventLike {
    button?: number;
    clientX: number;
    clientY: number;
    pointerId?: number;
    preventDefault?(): void;
    target?: unknown;
    currentTarget?: unknown;
}
/** 活动交互会话（常驻监听器驱动；会话寄存器 + 增量位移）。 */
export interface InteractionSession {
    kind: 'drag' | 'resize';
    pointerId: number;
    lastX: number;
    lastY: number;
    bounds: WindowBounds;
    direction?: ResizeDirection;
}
/** 标题栏/缩放把手内的可交互节点（按钮等）不触发拖动。 */
export declare function isInteractive(target: EventTarget | null): boolean;
/** 几何钳制：视口内定位；尺寸最小 480×320、最大 = 视口（防延展超出浏览器）。 */
export declare function clampBounds(next: WindowBounds): WindowBounds;
/**
 * FAB + 浮窗宿主：FAB 固定右下角；打开后渲染可拖动/可缩放的窗口。
 * 几何状态本地管理（与工作台状态机解耦），持久化记忆。
 */
export declare function FloatingWindow({ t, open, onClose, children }: FloatingWindowProps): import("react").JSX.Element;
