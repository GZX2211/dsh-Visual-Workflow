import type { StorageLike } from '../lib/storage.js';
import type { PanelLayout } from './studio-types.js';
/** localStorage 键（左右宽度/底高沿用旧项目键名；mode 为折叠态新增键）。 */
export declare const LAYOUT_KEYS: {
    readonly mode: "visual-workflow:panel-mode";
    readonly leftWidth: "visual-workflow:left-width";
    readonly rightWidth: "visual-workflow:right-width";
    readonly bottomHeight: "visual-workflow:bottom-height";
};
/** 面板几何的可调方向（与 LAYOUT_KEYS 的几何键一一对应）。 */
export type PanelSizeSide = 'left' | 'right' | 'bottom';
/** 读取持久化面板几何与折叠态（非法/损坏/越界回退默认）。 */
export declare function restorePanels(storage: StorageLike): PanelLayout;
/** 写入折叠态（PANELS_SET 改 mode 后调用一次）。 */
export declare function keepPanelMode(storage: StorageLike, mode: number): void;
/** 写入某一向几何（拖动结束后调用一次）。 */
export declare function keepPanelSize(storage: StorageLike, side: PanelSizeSide, value: number): void;
