import type { GroupNode } from '../../host/shared/graph-model.js';
/** 组卡片内成员横向留白（布局专用；行高/列表起始复用 geometry 常量，仅一处定义）。 */
export declare const GROUP_MEMBER_PADDING = 10;
/**
 * 组卡片最小高度（容纳成员列表；用户手动设的更大高度优先）。
 * 与 geometry.groupCardSizeOf 同一口径（同一常量），两侧不会漂移。
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
    /** 列（层）间距。 */
    gutterX?: number;
    /** 行（层内单元）间距。 */
    gutterY?: number;
    /** 层内排序迭代轮数（0 = 不做交叉最小化）。 */
    maxOrderRounds?: number;
    /** 画布左上角留白（默认与旧布局一致：x=70, y=80）。 */
    originX?: number;
    originY?: number;
}
/** 布局结果（纯数据；调用方只读）。 */
export interface LayoutResult {
    /** 节点 id → 坐标（含组内成员与虚拟节点；虚拟节点沿用主节点坐标）。 */
    positions: Map<string, {
        x: number;
        y: number;
    }>;
    /** 节点 id → 列号（层号；仅布局单元与组内成员有值）。 */
    colOf: Map<string, number>;
    /** 流程单元的最大列号（未参与流程的节点排在其右侧）。 */
    maxCol: number;
    /** 回流边 id（被环检测剔除的边；供 UI 标注，不阻断）。 */
    reversedLineIds: string[];
    /** 告警（中文，面向用户/模型可读）。 */
    warnings: string[];
}
/** 布局缺省间距（与旧布局的视觉密度接近：旧 stepX=270 / stepY=180，卡片 208×116 → 间距 62/64）。 */
export declare const LAYOUT_DEFAULTS: {
    readonly gutterX: 72;
    readonly gutterY: 56;
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
