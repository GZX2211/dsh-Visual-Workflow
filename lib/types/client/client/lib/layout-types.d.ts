import type { GroupNode } from '../../host/shared/graph-model.js';
import { GROUP_MEMBER_PADDING } from './card-geometry.js';
/** 组卡片内成员横向留白（布局专用；本体在 lib/card-geometry.ts，与卡片最小高度共用同一常量）。 */
export { GROUP_MEMBER_PADDING };
/**
 * 组卡片最小高度（容纳成员列表；用户手动设的更大高度优先）。
 * 与 card-geometry.groupCardSizeOf 同一口径（同一常量），两侧不会漂移。
 */
export declare function groupCardMinHeight(group: GroupNode | {
    data?: {
        memberIds?: string[];
        size?: {
            h?: unknown;
        };
    };
}): number;
/** 布局节点元数据（宿主图模型 → 布局输入的最小投影）。 */
export interface LayoutNodeInput {
    id: string;
    kind: string;
    width: number;
    height: number;
    /** 虚拟节点引用的主节点 id（kind='proxy' 时必填）。 */
    sourceId?: string;
    /** 协作组成员所属组 id，或协作组卡片的成员清单（kind='group' 时必填）。 */
    groupId?: string | null;
    memberIds?: string[];
}
/** 布局选项（缺省值见 LAYOUT_DEFAULTS）。 */
export interface LayoutOptions {
    /**
     * 列间距：**前一列最右卡片的右边界 → 后一列最左卡片的左边界**（用户裁决 2026-09）。
     * 语义与「层内垂直间隔」分离，缺省 72。
     */
    columnGap?: number;
    /** 列内垂直最小间隔（同列卡片之间，含主干与数据节点之间），缺省 56。 */
    rowGap?: number;
    /** 主干层内排序迭代轮数（0 = 不做交叉最小化）。 */
    maxOrderRounds?: number;
    /** 画布左上角留白（默认与旧布局一致：x=70, y=80）。 */
    originX?: number;
    originY?: number;
}
/** 布局结果（纯数据；调用方只读）。 */
export interface LayoutResult {
    /** 节点 id → 坐标（含组内成员与虚拟节点；虚拟节点独立占位，与主节点不再重叠）。 */
    positions: Map<string, {
        x: number;
        y: number;
    }>;
    /** 节点 id → 列号（层号；布局单元与组内成员均有值）。 */
    colOf: Map<string, number>;
    /** 主干流程的最大列号（孤立节点列排在其右侧，列号 > maxCol）。 */
    maxCol: number;
    /** 流程主干的中轴 Y（各列主干卡片共线于该 Y；数据节点贴轴上下堆叠）。 */
    axisY: number;
    /** 孤立节点（未参与流程）所在列号（无孤立节点时与 maxCol 一致）。 */
    orphanCol: number;
    /** 回流边 id（被环检测剔除的边；供 UI 标注，不阻断）。 */
    reversedLineIds: string[];
    /** 告警（中文，面向用户/模型可读）。 */
    warnings: string[];
}
/**
 * 布局缺省参数。
 * - columnGap=72：列间距（前一列右边界 → 后一列左边界）；
 * - rowGap=56：列内垂直最小间隔（主干与数据节点贴轴堆叠的间隔）；
 * - originX/originY：画布左上留白（originY 即主轴高度基准，主轴 Y = originY + 主干卡片高/2）。
 */
export declare const LAYOUT_DEFAULTS: {
    readonly columnGap: 72;
    readonly rowGap: 56;
    readonly maxOrderRounds: 4;
    readonly originX: 70;
    readonly originY: 80;
};
/** 位置哨兵：{x:0,y:0} 视为「未布局」（新建/导入/代理落盘时可能缺坐标）。 */
export declare const SENTINEL_POSITION: {
    readonly x: 0;
    readonly y: 0;
};
/** 是否为缺失/哨兵坐标（自动布局触发判据）。 */
export declare function isSentinelPosition(position: {
    x: number;
    y: number;
} | null | undefined): boolean;
