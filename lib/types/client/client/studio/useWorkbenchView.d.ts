/** 视图模式。 */
export type WorkbenchViewMode = 'float' | 'split';
/** 视图模式持久化键。 */
export declare const VIEW_MODE_KEY = "visual-workflow:view-mode";
/** 分栏窗口宽度持久化键。 */
export declare const SPLIT_WIDTH_KEY = "visual-workflow:split-width";
/** 分栏宽度默认值（px）。 */
export declare const SPLIT_WIDTH_DEFAULT = 640;
/** 分栏窗格最小/最大宽度（px）。 */
export declare const SPLIT_WIDTH_MIN = 360;
export declare const SPLIT_WIDTH_MAX = 1280;
/** 极简存储抽象（便于单测注入 localStorage mock）。 */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** 读取视图模式（损坏/未知回退 float）。 */
export declare function readViewMode(storage: StorageLike): WorkbenchViewMode;
/** 写入视图模式。 */
export declare function writeViewMode(storage: StorageLike, mode: WorkbenchViewMode): void;
/** 读取分栏宽度（钳制到合法区间）。 */
export declare function readSplitWidth(storage: StorageLike): number;
/** 写入分栏宽度。 */
export declare function writeSplitWidth(storage: StorageLike, width: number): void;
/** 钳制分栏宽度到合法区间。 */
export declare function clampSplitWidth(width: number): number;
/** 官方整体框架（frame）：sidebarCol 的父节点；grid 容器（分栏不修改它）。 */
export declare function officialFrame(): HTMLElement | null;
/** 官方对话主区域列（centerCol）：分栏时给它设右内边距让出右侧。 */
export declare function officialCenterCol(): HTMLElement | null;
/** 官方侧边栏底部「设置」按钮（入口锚点：插到其上方 + 复制其样式）。 */
export declare function officialSettingButton(): HTMLElement | null;
/** 官方某列的选择器（保留导出）。 */
export declare function officialCol(segment: 'sidebarCol' | 'centerCol' | 'detailsCol'): HTMLElement | null;
/** 构建侧边栏入口按钮元素（图标 + 「工作流」）。
 *  样式与官方「设置」按钮一致：不复用其 className（CSS-module hash 类随构建/版本变化，
 *  且复制到的 hashed 类在部分状态下会引入浏览器默认外圈边框/发光层）。改为由 styles.ts 的
 *  button.wf-sidebar-entry 直接提取官方 trigger 样式逐字复刻，视觉与「设置」按钮完全一致，
 *  且不受 hash/主题状态影响。
 *  @param officialBtn 官方「设置」按钮，预留（当前不再读取其 className）；缺省仅 wf-sidebar-entry。 */
export declare function buildSidebarEntryButton(label: string, officialBtn?: HTMLElement | null): HTMLButtonElement;
/**
 * 进入分栏：给官方对话主列 centerCol 设右内边距（左侧对话区），并把分栏宽度写入
 * :root CSS 变量（供 fixed 工作台使用）。**不修改官方 frame 网格结构**。
 * @param centerCol 官方对话主列。
 * @param width 分栏宽度（px）。
 */
export declare function enterSplit(centerCol: HTMLElement, width: number): void;
/** 退出分栏：还原官方对话主列右内边距与 :root CSS 变量。 */
export declare function exitSplit(): void;
export interface WorkbenchViewFace {
    /** 工作台是否打开。 */
    open: boolean;
    /** 当前视图模式。 */
    viewMode: WorkbenchViewMode;
    /** 分栏宽度（px）。 */
    splitWidth: number;
    /** 打开工作台（侧边栏入口点击）。 */
    openWorkbench(): void;
    /** 关闭工作台。 */
    closeWorkbench(): void;
    /** 切换工作台开关（侧边栏入口「再次点击关闭」；浮窗/分栏共用）。 */
    toggleOpen(): void;
    /** 设置视图模式（并持久化、驱动分栏 DOM 注入）。 */
    setViewMode(mode: WorkbenchViewMode): void;
    /** 在 float/split 之间切换（标题栏窗口切换按钮）。 */
    toggleView(): void;
    /** 设置分栏宽度（拖动分隔线；更新 centerCol 内边距与 :root 变量并持久化）。 */
    setSplitWidth(width: number): void;
}
/** 工作台视图模式状态机。
 *  @param entryLabel 侧边栏入口按钮文案（随语言切换更新；由 WorkbenchHost 传入 t 词典
 *  对应键，如 t.workflows）。默认 '工作流'（保持既有行为）。 */
export declare function useWorkbenchView(entryLabel?: string): WorkbenchViewFace;
