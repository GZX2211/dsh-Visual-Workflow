import type { Dict } from '../../i18n.js';
import type { CanvasEdge, CanvasNode } from '../../studio/studio-state.js';
export interface CanvasApi {
    fitView(options?: {
        padding?: number;
        nodes?: CanvasNode[];
    }): void;
    focusNode(id: string, options?: {
        zoom?: number;
    }): void;
    zoomIn(): void;
    zoomOut(): void;
    screenToWorld(clientX: number, clientY: number): {
        x: number;
        y: number;
    };
}
export interface GraphCanvasProps {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    copy: Dict & {
        modeName(id: string | null | undefined): string;
    };
    mode: 'mode1' | 'mode2';
    selectedNode: string | null;
    selectedEdge: string | null;
    runStatusByNode: Record<string, {
        status: string;
        attempts: number;
        outputSummary: string;
    }>;
    highlightedNodeIds: string[];
    /**
     * 运行中锁定项（已完成流程不可变更；模式一 running 时由 run-locks 计算）：
     * 节点显示锁角标、被锁连线渲染为灰化虚线，点击不选中（属性栏不展开）。
     */
    lockedNodeIds?: ReadonlySet<string>;
    lockedEdgeIds?: ReadonlySet<string>;
    onInit(api: CanvasApi): void;
    onNodeDragStart(): void;
    onNodeMove(id: string, position: {
        x: number;
        y: number;
    }): void;
    /** 角色节点拖入协作组（需求 §4.2.5.2 规则 1）。 */
    onNodeDropToGroup(nodeId: string, groupId: string): void;
    onNodeSelect(id: string): void;
    onEdgeSelect(id: string): void;
    onPaneClick(): void;
    onConnect(connection: {
        source: string;
        target: string;
        sourceHandle: string;
        targetHandle: string;
    }): void;
    onConnectionRejected(): void;
    onGroupResize(id: string, size: {
        w: number;
        h: number;
    }): void;
    /** 交换节点左右连接点（用户批注：美化布线防交叉）。 */
    onSwapPorts(id: string): void;
    /** 左栏拖拽悬停的协作组 id（组卡片高亮 + 「放开以入组」提示）。 */
    dropTargetGroupId?: string | null;
    fitLabel: string;
    zoomInLabel: string;
    zoomOutLabel: string;
    emptyHint: string;
    /** 画布左上角工作流名称角标（实例/模板 + 名称）。 */
    workflowCaption?: string;
}
export declare function GraphCanvas(props: GraphCanvasProps): import("react").JSX.Element;
