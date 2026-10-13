import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js';
export declare const GRAPH_MIN_ZOOM = 0.5;
export declare const GRAPH_MAX_ZOOM = 2.5;
/** 接点垂直位置（百分比）：db 最上、ctx 上、flow 下。 */
export declare function handleY(handle: string): number;
export declare function clamp(value: number, minimum: number, maximum: number): number;
export interface EdgeGeometry {
    start: {
        x: number;
        y: number;
    };
    end: {
        x: number;
        y: number;
    };
    /** 贝塞尔控制点 1（源端口向外伸出方向）。 */
    c1: {
        x: number;
        y: number;
    };
    /** 贝塞尔控制点 2（目标端口外侧进入方向）。 */
    c2: {
        x: number;
        y: number;
    };
    label: {
        x: number;
        y: number;
    };
    path: string;
}
/**
 * 成员 id → 所属组 的预建索引。
 * 为什么需要：所属组反查若按全节点扫描，连线几何会对每条边扫两次全节点（O(边×节点)），
 * 且拖拽时每帧执行；索引化后由 GraphCanvas 按节点集预建一次，逐边只做 O(1) 命中。
 * 同一成员出现在多个组时按节点顺序取先到的组，与原先的全量扫描口径一致。
 */
export type MemberGroupIndex = Map<string, CanvasNode>;
/** 由画布节点表预建成员 → 组索引（一次全量扫描，替代逐边反查）。 */
export declare function memberGroupIndexOf(byId: Map<string, CanvasNode>): MemberGroupIndex;
/** 组内成员连线锚点（组卡片左/右边缘 + 成员行中心）。 */
export declare function memberAnchor(group: CanvasNode, memberId: string, side: 'left' | 'right'): {
    x: number;
    y: number;
} | null;
/**
 * 节点是否交换了左右连接点（卡片右上角切换按钮，用户批注：美化布线防交叉）。
 * 交换后：出点移到左侧、入点移到右侧；节点 JSON 即事实源，swapPorts 随节点持久化。
 */
export declare function swappedOf(node: CanvasNode | null | undefined): boolean;
/** 连线贝塞尔几何（源端口 → 目标端口；组卡片流程接点居中，组内成员锚到成员行）。
 *  交换过连接点的节点：源出点改在左边缘（start.x=左侧），目标入点改在右边缘（end.x=右侧）。
 *  控制点方向跟随端口所在边缘（右缘向外 +x、左缘向外 -x），连线从正确一侧进出，不会
 *  穿入卡片体被遮挡（用户批注：连线方向应当根据连接点确定，而非默认朝右）。 */
export declare function edgeGeometry(edge: CanvasEdge, byId: Map<string, CanvasNode>, memberGroups: MemberGroupIndex): EdgeGeometry | null;
