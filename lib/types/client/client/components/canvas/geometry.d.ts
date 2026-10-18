import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js';
export declare const GRAPH_MIN_ZOOM = 0.5;
export declare const GRAPH_MAX_ZOOM = 2.5;
/** 接点垂直位置（百分比）：db 最上、ctx 上、flow 下。 */
export declare function handleY(handle: string): number;
/** Team 卡片上下文入点的纵向比例（靠近标题，与居中的流程入点拉开；与样式片段对锁）。 */
export declare const GROUP_CTX_IN_TOP = 0.3;
/**
 * 组内成员接点纵向比例（成员行内位置；与样式 .wf-graph__handle--member-* 对锁）。
 * ctx-out 已从 UI 退役，这里仍保留其比例：历史连线即使被隐藏，几何函数也应保持确定输出。
 */
export declare const MEMBER_HANDLE_TOP: Record<string, number>;
/**
 * 成员接点中心相对 Team 卡片左右边缘的内缩。
 * 由盒模型累加：卡片外边框 1 + 卡片内边距 12 + 成员列表边框 1 + 列表内边距 6
 * + 接点半宽 0.5（接点 left/right: -6px、宽 13px）。
 */
export declare const GROUP_MEMBER_HANDLE_INSET_X = 20.5;
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
/**
 * 组内成员连线锚点：成员迷你卡内侧的真实接点中心。
 * 不再使用 Team 卡片外缘 / 成员行中心——前者让线端停在卡片边框外，后者让线端偏离
 * 实际渲染的接点（ctx-in 在行下部、db-in 在行上部）。
 */
export declare function memberAnchor(group: CanvasNode, memberId: string, handle: string): {
    x: number;
    y: number;
} | null;
/** Team 卡片接点纵向位置：ctx-in 位于标题下方，flow 接点保持居中（与 GroupCard 样式同源）。 */
export declare function groupHandleY(handle: string): number;
/**
 * 节点是否交换了左右连接点（卡片右上角切换按钮，用户批注：美化布线防交叉）。
 * 交换后：出点移到左侧、入点移到右侧；节点 JSON 即事实源，swapPorts 随节点持久化。
 */
export declare function swappedOf(node: CanvasNode | null | undefined): boolean;
/** 连线贝塞尔几何（源端口 → 目标端口；Team 接点按 handle 定高，组内成员锚到真实接点）。
 *  交换过连接点的节点：源出点改在左边缘（start.x=左侧），目标入点改在右边缘（end.x=右侧）。
 *  控制点方向跟随端口所在边缘（右缘向外 +x、左缘向外 -x），连线从正确一侧进出，不会
 *  穿入卡片体被遮挡（用户批注：连线方向应当根据连接点确定，而非默认朝右）。 */
export declare function edgeGeometry(edge: CanvasEdge, byId: Map<string, CanvasNode>, memberGroups: MemberGroupIndex): EdgeGeometry | null;
/**
 * Team 成员入线的「卡片内段」路径：从 Team 卡片边缘切到成员接点。
 *
 * 为什么需要单独一段：SVG 连线层位于节点卡片之下，线段进入 Team 卡片后会被卡片背景
 * 遮挡；覆盖层把这一段画在卡片之上、接点之下，线端才能真正落到成员接点上。
 * 返回 null 表示目标不是组内成员，或线段没有进入卡片。
 */
export declare function memberInboundStubPath(edge: CanvasEdge, byId: Map<string, CanvasNode>, memberGroups: MemberGroupIndex): string | null;
