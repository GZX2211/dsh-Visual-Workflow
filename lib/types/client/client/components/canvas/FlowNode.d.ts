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
    /** P4：该节点是最近一次**父代理补丁**（origin='agent'）改动的节点 → 显示「AI 调整」角标。 */
    agentPatched?: boolean;
    onPointerDown(event: React.PointerEvent, id: string): void;
    onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void;
    /** 交换左右连接点（节点属性 swapPorts 取反）。 */
    onToggleSwap(id: string): void;
}
/**
 * 节点卡片以 memo 包住：父组件拖拽/平移/缩放等本地渲染态变化时，未变的节点不重渲染
 * （回调由 GraphCanvas 以 useCallback 固定引用，节点对象与运行状态对象保持原引用）。
 */
export declare const FlowNode: import("react").MemoExoticComponent<({ node, copy, mode, selected, highlighted, dragging, runStatus, locked, lockHint, agentPatched, onPointerDown, onHandlePointerDown, onToggleSwap }: FlowNodeProps) => import("react").JSX.Element>;
export {};
