import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js';
export declare const GRAPH_NODE_WIDTH = 208;
export declare const GRAPH_NODE_HEIGHT = 116;
export declare const GRAPH_NODE_SIZE: {
    w: number;
    h: number;
};
/** 阶段节点（启动/结束/暂停）紧凑卡片：流程门无需大卡，避免占用画布空间。 */
export declare const GRAPH_STAGE_WIDTH = 168;
export declare const GRAPH_STAGE_HEIGHT = 88;
export declare const GRAPH_STAGE_SIZE: {
    w: number;
    h: number;
};
export declare const GRAPH_GROUP_WIDTH = 300;
export declare const GRAPH_GROUP_HEIGHT = 220;
/** 组内成员行高/列表起始（与 GroupCard 布局一致，连线锚点用；成员为迷你角色卡，略高于纯文本行）。 */
export declare const GROUP_MEMBER_ROW_H = 38;
export declare const GROUP_MEMBER_LIST_TOP = 78;
export declare const GRAPH_MIN_ZOOM = 0.5;
export declare const GRAPH_MAX_ZOOM = 2.5;
/** 节点实际尺寸（协作组卡片可拉伸，尺寸存 data.size；阶段节点用紧凑卡）。 */
export declare function nodeSizeOf(node: CanvasNode): {
    w: number;
    h: number;
};
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
/** 成员所在组（画布节点含该成员）。 */
export declare function groupOfMember(byId: Map<string, CanvasNode>, memberId: string): CanvasNode | null;
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
export declare function edgeGeometry(edge: CanvasEdge, byId: Map<string, CanvasNode>): EdgeGeometry | null;
/** 命中检测：鼠标坐标下的节点 id（最近 data-wf-node-id 祖先）。 */
export declare function connectionTargetAt(clientX: number, clientY: number): string | null;
/**
 * 协作组表面命中（入组判定，用户批注 §4.2.5.2 收紧：仅组卡片表面可入组）：
 *  - 跳过不在协作组内的元素（画布空白/连线 SVG/其他节点等装饰层）；
 *  - 跳过被拖拽本体节点（拖拽时节点被挪到鼠标下方，若不排除会遮蔽组表面命中）；
 *  - 命中 `.wf-graph__handle`（连接点）→ 返回 null：连接点**不具入组功能**。
 * 返回命中的协作组 id；否则 null。纯函数接收元素数组，便于 jsdom 单测。
 */
export declare function groupSurfaceFromElements(elements: Element[], excludeNodeId?: string | null): string | null;
/** 鼠标坐标下的协作组表面（入组落点；封装 elementsFromPoint，供拖拽 onMove/onUp 共用）。 */
export declare function groupSurfaceUnderPoint(clientX: number, clientY: number, excludeNodeId?: string | null): string | null;
