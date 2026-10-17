import type { LayoutOptions, LayoutResult } from './layout-types.js';
/** 画布节点最小形状（只读 id/kind/position/data；不绑定 studio 状态类型）。 */
export interface LayoutBoxNode {
    id: string;
    kind: string;
    position: {
        x: number;
        y: number;
    };
    data?: Record<string, unknown>;
}
/** 布局入参的最小节点形状：布局只读 id/kind/data，尺寸另行解析（不绑定画布投影类型）。 */
export interface LayoutNodeLike {
    id: string;
    kind: string;
    data?: Record<string, unknown>;
}
/** 布局入参的最小连线形状：id 仅用于诊断回传，连接点用于 flow 与数据关联分类。 */
export interface LayoutLineLike {
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}
/** 渲染盒子（用于重叠判定；不含组内成员与虚拟节点）。 */
export interface LayoutBox {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}
/**
 * 是否需要自动布局：任一节点坐标缺失/非有限数/为哨兵 {0,0} 即为真。
 * 语义：新节点默认写哨兵坐标（或干脆不写），打开/接收文档时据此自动重排一次。
 */
export declare function needsAutoLayout(nodes: LayoutBoxNode[] | null | undefined): boolean;
/** Team 成员的 id 集合（以组的 memberIds 为准；用于排除重复渲染节点）。 */
export declare function groupMemberIdsOf(nodes: LayoutBoxNode[] | null | undefined): Set<string>;
/**
 * 实际渲染盒子清单：Team 卡片 + 独立节点（组内成员不独立渲染；虚拟节点独立占位，参与判定）。
 * 为什么排除组内成员：GraphCanvas 只渲染 Team 卡片与独立节点（组内成员以迷你卡渲染在卡片内），
 * 对它们做重叠判定会产生「永远重叠」的假告警。
 */
export declare function layoutBoxesOf(nodes: LayoutBoxNode[] | null | undefined, sizeOf: (node: LayoutBoxNode) => {
    w: number;
    h: number;
}, 
/** 额外排除的节点 id（布局输入已折叠的组员；缺省只按 data 推导）。 */
excludedIds?: Iterable<string>): LayoutBox[];
/** 两盒子是否相交（边贴边不算相交；零面积盒子不参与）。 */
export declare function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean;
/** 全部重叠对（id 对按字典序归一，便于断言与去重）。 */
export declare function findLayoutOverlaps(boxes: LayoutBox[] | null | undefined): Array<[string, string]>;
/**
 * 布局中被折叠（不占位置槽）的节点 id 集合：仅 Team 成员。
 * 与 layout.ts 的折叠规则同源（虚拟节点独立占位，不再折叠到主节点）；供重叠判定与 UI 使用。
 */
export declare function collapsedIdsOf(inputs: Array<{
    id: string;
    kind: string;
    sourceId?: string;
    memberIds?: string[];
}>): Set<string>;
/**
 * 统一布局入口（「整理布局」按钮与自动布局共用同一实现）：
 * 「宿主节点 → 布局输入 → 分层布局 → 坐标写回」四步收敛在一处，
 * 避免两条路径各写一遍而坐实「两份布局算法漂移」。
 * @param sizeOf 卡片尺寸解析（通常为 card-geometry.groupCardSizeOf）；
 *   形参是布局最小节点面（id/kind/data），调用方无需为类型擦除做断言。
 */
export declare function tidyNodes<T extends LayoutBoxNode>(nodes: T[], lines: LayoutLineLike[], options?: {
    sizeOf: (node: LayoutNodeLike) => {
        w: number;
        h: number;
    };
    layout?: LayoutOptions;
}): {
    nodes: T[];
    result: LayoutResult;
};
/**
 * 把布局结果写回节点（返回新数组，不改写入参）：
 * 只改 position，其余字段保持原引用（几何改动不算编排变更，见 flow-diff 语义）。
 * 布局结果里没有坐标的节点保持原样（防御：理论上布局覆盖全部节点）。
 */
export declare function applyLayout<T extends LayoutBoxNode>(nodes: T[], result: LayoutResult): T[];
/**
 * 层次布局（「整理布局」与自动布局的共用入口）：委托给分层布局实现。
 *
 * 为什么不复用旧实现：proxy 入边计入 indegree 导致主节点被推到引用节点
 * 之后、不看卡片实际尺寸必然重叠、组内成员不参与布局、无层内排序、孤立节点塞进流程最右列、
 * 无长边处理、无环路处理。
 *
 * 新实现落点：
 *   - 算法：src/client/lib/layout.ts（分层 + 层内重心排序 + 按实际尺寸生成坐标）；
 *   - 统一入口：本文件 tidyNodes（尺寸解析 + 坐标写回四步收敛）；
 *   - 尺寸口径：src/client/lib/card-geometry.ts 的 groupCardSizeOf。
 * 本函数保持原有签名与「返回含新 position 的新数组」语义：既有调用方与测试零改动。
 */
export declare function layoutNodes<T extends LayoutBoxNode>(nodes: T[], lines: LayoutLineLike[]): T[];
