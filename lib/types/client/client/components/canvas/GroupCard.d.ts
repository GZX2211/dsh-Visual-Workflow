import type { Dict } from '../../i18n.js';
import type { CanvasNode } from '../../studio/studio-state.js';
interface GroupCardProps {
    node: CanvasNode;
    copy: Dict;
    members: Array<{
        id: string;
        label: string;
        status: string | null;
        locked?: boolean;
    }>;
    selected: boolean;
    /** 联动高亮（与角色节点同款语义：外部选择/定位聚焦到本卡）。 */
    highlighted?: boolean;
    /** 组卡片运行状态（快照 nodes[].status；缺省不渲染徽标）。 */
    runStatus?: {
        status: string;
        attempts: number;
    } | null;
    /** 拖拽悬停目标（左栏角色卡拖入时高亮并提示「放开以入组」）。 */
    dropTarget: boolean;
    /** 组卡片自身运行中锁定（已完成/执行中）：锁角标 + 悬停提示。 */
    locked?: boolean;
    lockHint?: string;
    onPointerDown(event: React.PointerEvent, id: string): void;
    onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void;
    onMemberSelect(id: string): void;
    onResizeStart(event: React.PointerEvent, id: string, direction: string): void;
}
/**
 * 以 memo 包住：父组件拖拽/平移/缩放等本地渲染态变化时，只要组卡输入（节点、成员列表、
 * 选中/高亮/锁定、回调引用）未变即不重渲染；成员列表由 GraphCanvas 以 useMemo 保持引用稳定。
 */
export declare const GroupCard: import("react").MemoExoticComponent<({ node, copy, members, selected, highlighted, runStatus, dropTarget, locked, lockHint, onPointerDown, onHandlePointerDown, onMemberSelect, onResizeStart }: GroupCardProps) => import("react").JSX.Element>;
export {};
