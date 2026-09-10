import { type SlotsServiceLike } from './workbench-tab.js';
/** 入口按钮注册的插槽 key。 */
export declare const WORKBENCH_ENTRY_SLOT = "sidebar.footer.action";
/** 入口按钮在插槽内的排序（升序；官方随包条目在侧边栏底部「设置」旁）。 */
export declare const WORKBENCH_ENTRY_ORDER = 100;
/**
 * 设置入口按钮的点击处理。
 * @param handler - 处理函数；null 表示插件卸载（按钮点击变为无操作）。
 */
export declare function setWorkbenchOpenHandler(handler: (() => void) | null): void;
/** 测试用：读取当前点击处理。 */
export declare function getWorkbenchOpenHandler(): (() => void) | null;
/** 官方右侧 Sidebar 服务的最小形状（ISidebarRight 的运行时守卫子集）。 */
export interface SidebarRightLike {
    /** 按 kind 打开页面类型；会自动展开列并在目标 pane 内去重聚焦。 */
    openTab?(kind: string, options?: unknown): void;
    /** 当前是否有挂载的会话面板（无 seat 时 undefined）。 */
    active?(): unknown;
}
/** 官方 layout 服务的最小形状（仅用于「先回到会话界面」的兜底导航）。 */
export interface LayoutLike {
    /** 选中全局面板；null = 回到会话界面。 */
    selectPanel?(panelId: unknown): void;
}
/**
 * 构造入口按钮的点击处理：打开（或聚焦）工作台标签页。
 *
 * 失败模式（官方取证）：
 *   - `sidebarRight` 服务缺失（非 Web 组合）→ 静默降级，不做任何事；
 *   - 无挂载的会话 seat（首页无会话 / 用户停在某个全局面板）→ 官方 `openTab` 会抛
 *     `sidebarRight: no session surface is mounted`。此时先调 `layout.selectPanel(null)`
 *     回到会话界面（`RightbarRoot` 仅在此刻挂载 seat 子树），下一拍重试一次。
 *
 * @param ctx - 插件 apply 的上下文（`get(name)`）。
 * @returns 点击处理函数（永不抛错）。
 */
export declare function createWorkbenchOpener(ctx: {
    get?(name: string): unknown;
}): () => void;
/** 入口按钮 props（owner props + 可选注入面）。 */
export interface WorkbenchEntryButtonProps {
    /** owner props：侧边栏是否宽屏渲染（false = 56px 折叠轨道，只显示图标）。 */
    wide?: boolean;
}
/**
 * 侧边栏底部「工作流」入口按钮。
 * 展开态 = 三横线图标 + 文案；折叠态 = 仅图标（与官方「设置」按钮同级视觉）。
 */
export declare function WorkbenchEntryButton({ wide }: WorkbenchEntryButtonProps): import("react").JSX.Element;
/**
 * 把入口按钮注册进官方 `sidebar.footer.action` 插槽。
 * @param slots - ctx.slots。
 * @returns 注销函数（由 ctx.effect 拥有）。
 */
export declare function injectWorkbenchEntry(slots: SlotsServiceLike): () => void;
