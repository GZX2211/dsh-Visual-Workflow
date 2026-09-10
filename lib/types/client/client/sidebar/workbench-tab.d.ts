/** 本实现在标签页系统中的唯一身份；同时是 body / title 插槽的注册 key。 */
export declare const WORKBENCH_TAB_ID = "dsh-visual-workflow";
/** 页面类型的类型判别符（`ctx.sidebarRight.openTab(kind)` 用它打开）。 */
export declare const WORKBENCH_TAB_KIND = "visual-workflow";
/** body 注册的插槽 key。 */
export declare const WORKBENCH_TAB_SLOT = "sidebar.right.pane.tab";
/** 常驻容器的 DOM id（entry.ts 创建；样式在 styles.ts）。 */
export declare const WORKBENCH_CONTAINER_ID = "visual-workflow-workbench-host";
/** 常驻容器的隐藏持有者 id（无标签页持有容器时容器回到这里）。 */
export declare const WORKBENCH_HOLDER_ID = "visual-workflow-workbench-holder";
/** 标签页类型定义（提交给 ctx.sidebarRightTabs.register 的纯数据）。 */
export interface WorkbenchTabDefinition {
    /** 实现身份（唯一）；body / title 插槽按它注册。 */
    id: string;
    /** 类型判别符；`openTab` 用它打开。 */
    kind: string;
    /** 优先级带。 */
    priority: 'extension' | 'builtin' | 'fallback';
    /**
     * 标签 chip 的初始标题（打开时被捕获进布局记录）。
     * 官方文档明确：thunk 每次投影都重新读取，故语言切换无需重新注册 —— 这里读取
     * 模块级词典桥的当前值，天然跟随语言切换。
     */
    title: () => string;
}
/**
 * 构造标签页类型定义。
 *
 * - 不写 `patterns` → 页面类型（按 kind 打开，不参与资源地址认领，绝不会抢官方文件预览）；
 * - 不写 `guide` → **刻意**：官方 `defaultSeed` 按 guide 条目总数决定新面板的默认页，
 *   当前随包组合只有「文件」1 条；再加一条会把新面板默认页从「文件」变成 guide 页，
 *   属改变官方既有行为。工作台改由插件入口按钮打开。
 * @returns 类型定义（每次调用返回新对象；title 为读取词典桥的 thunk）。
 */
export declare function workbenchTabDefinition(): WorkbenchTabDefinition;
/** 常驻容器的宿主信息（holder = 无标签页持有时容器所在处）。 */
export interface WorkbenchMountHost {
    /** 隐藏持有者：无存活标签页 body 时容器停放于此（display:none）。 */
    holder: HTMLElement;
    /** 常驻容器：内部是独立的 React root（Studio 永不卸载）。 */
    container: HTMLElement;
}
/**
 * 设置（或清空）常驻容器宿主。
 * @param host - 宿主信息；null 表示插件卸载（清空全部挂载点登记）。
 */
export declare function setWorkbenchMountHost(host: WorkbenchMountHost | null): void;
/** 测试用：读取当前宿主（null 表示未初始化）。 */
export declare function getWorkbenchMountHost(): WorkbenchMountHost | null;
/**
 * 登记一个标签页 body 挂载点并接管常驻容器；返回注销（body 卸载时调用）。
 * @param host - body 内的挂载点元素。
 * @returns 注销函数（把容器交还给下一个存活挂载点或隐藏 holder）。
 */
export declare function attachWorkbenchHost(host: HTMLElement): () => void;
/**
 * 测试用：读取当前是否有挂载点登记（判定「谁持有容器」）。
 * @returns 存活挂载点数量。
 */
export declare function liveWorkbenchHostCount(): number;
/**
 * 工作台标签页 body：只承载常驻容器。
 * - 激活时把常驻容器移入本节点（Studio 立即可见，且**从未卸载**，状态原样）；
 * - 卸载时把容器交还（下一个存活 body，或隐藏 holder）；
 * - 未持有容器时（多 body 并存）显示占位提示，避免出现「空白面板」。
 */
export declare function WorkbenchTabBody(): import("react").JSX.Element;
/**
 * 若官方右侧 Sidebar 处于**全屏**展示，则点击官方自己的展示模式切换按钮把它缩回；
 * 非全屏时保持原状（返回 false，不做任何事）。
 *
 * 为什么用 DOM 点击而不是 API：官方 `ctx.sidebarRight`（ISidebarRight）**没有**任何
 * fullscreen 方法（只有 isExpanded / toggleExpanded，官方注释明确「presentation switch
 * 是面板自己的控件，不属于该 face」）；`ctx.layout.openRightbar(track, fullscreen)` 是
 * 面板 seat **向** layout frame 的单向上报通道，反向调用会与 seat 的下一次上报互相打架。
 * 故采用官方自带的自动化属性：面板元素带 `data-sidebar-right-panel="fullscreen"` 表示
 * 处于全屏，此时其模式按钮带 `data-sidebar-right-mode="push"`（该属性恒为「下一个模式」）。
 *
 * @returns 是否执行了缩回（true = 曾处于全屏且已点击；false = 非全屏或未找到按钮）。
 */
export declare function shrinkOfficialSidebarIfFullscreen(): boolean;
/** slots 服务最小形状（0.1.5-rc.1 官方形态）。 */
export interface SlotsServiceLike {
    /** 等待插槽被声明后安装贡献；callback 必须**返回**其 disposer。 */
    inject?(key: string, callback: () => unknown): unknown;
    /** 注册组件到某插槽。 */
    register?(options: Record<string, unknown>, component: unknown): unknown;
}
/** sidebarRightTabs 服务最小形状（阶段一注册表）。 */
export interface SidebarRightTabsServiceLike {
    register(definition: unknown): () => void;
}
/**
 * 阶段一：注册工作台标签页类型。
 * @param tabs - ctx.sidebarRightTabs。
 * @returns 注销函数（由 ctx.effect 拥有）。
 */
export declare function registerWorkbenchTabType(tabs: SidebarRightTabsServiceLike): () => void;
/**
 * 阶段二：把 body 注册进 keyed 插槽 `sidebar.right.pane.tab`（key = 类型定义的 id）。
 * @param slots - ctx.slots。
 * @returns 注销函数（由 ctx.effect 拥有）。
 */
export declare function injectWorkbenchTabBody(slots: SlotsServiceLike): () => void;
