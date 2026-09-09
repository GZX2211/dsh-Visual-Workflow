import type { ReactNode } from 'react';
import { type DragEventLike } from './floating-window.js';
/** 窗口框架给内容（Studio）的 api：close 关闭工作台；drag 标题栏拖动把手（仅浮窗生效）。 */
export interface WorkbenchFrameApi {
    close: () => void;
    drag: (event: DragEventLike) => void;
}
export interface WorkbenchFrameProps {
    /** 视图模式：float=悬浮窗口（可拖/缩放）；split=分栏窗口（右侧固定 + 可拖分隔线）。 */
    mode: 'float' | 'split';
    /** 关闭回调（标题栏 ×；分栏模式不渲染关闭按钮，由 WorkbenchHost 决定传不传）。 */
    onClose: () => void;
    /** 当前分栏宽度（px；split 模式分隔线拖动回传）。 */
    splitWidth: number;
    /** 分隔线拖动回传新宽度（宿主持久化 + 更新官方对话列内边距）。 */
    onResize: (width: number) => void;
    /** 内容渲染（Studio）；api.close/api.drag 供标题栏使用。 */
    children: (api: WorkbenchFrameApi) => ReactNode;
    /** 工作台是否关闭（隐藏不卸载：外壳 display:none，内容保持挂载、状态原样保留）。 */
    hidden?: boolean;
}
/**
 * 工作台统一窗口框架：children（Studio）恒挂载于框架内，视图模式切换与
 * 关闭（hidden）都不重建。浮窗几何（bounds）本地管理并持久化；切换分栏
 * 再切回时几何原样恢复。
 */
export declare function WorkbenchFrame({ mode, onClose, splitWidth, onResize, hidden, children }: WorkbenchFrameProps): import("react").JSX.Element;
