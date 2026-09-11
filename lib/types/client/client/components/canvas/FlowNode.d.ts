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
    /** 运行中锁定（已完成/执行中）：显示锁角标 + 悬停提示；不影响拖动移动。 */
    locked?: boolean;
    /** 锁定时显示的悬停说明（已完成/执行中文案不同）。 */
    lockHint?: string;
    onPointerDown(event: React.PointerEvent, id: string): void;
    onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void;
    /** 交换左右连接点（节点属性 swapPorts 取反）。 */
    onToggleSwap(id: string): void;
}
export declare function FlowNode({ node, copy, mode, selected, highlighted, dragging, runStatus, locked, lockHint, onPointerDown, onHandlePointerDown, onToggleSwap }: FlowNodeProps): import("react").JSX.Element;
export {};
