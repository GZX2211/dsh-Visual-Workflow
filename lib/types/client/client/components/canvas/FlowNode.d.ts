import type { Dict } from '../../i18n.js';
import type { CanvasNode } from '../../studio/studio-state.js';
interface FlowNodeProps {
    node: CanvasNode;
    copy: Dict & {
        modeName(id: string | null | undefined): string;
    };
    mode: 'mode1' | 'mode2';
    selected: boolean;
    highlighted: boolean;
    dragging: boolean;
    runStatus: {
        status: string;
        attempts: number;
    } | null;
    onPointerDown(event: React.PointerEvent, id: string): void;
    onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void;
    /** 交换左右连接点（节点属性 swapPorts 取反）。 */
    onToggleSwap(id: string): void;
}
export declare function FlowNode({ node, copy, mode, selected, highlighted, dragging, runStatus, onPointerDown, onHandlePointerDown, onToggleSwap }: FlowNodeProps): import("react").JSX.Element;
export {};
