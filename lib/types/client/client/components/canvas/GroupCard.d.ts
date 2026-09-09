import type { Dict } from '../../i18n.js';
import type { CanvasNode } from '../../studio/studio-state.js';
interface GroupCardProps {
    node: CanvasNode;
    copy: Dict;
    members: Array<{
        id: string;
        label: string;
        status: string | null;
    }>;
    selected: boolean;
    /** 拖拽悬停目标（左栏角色卡拖入时高亮并提示「放开以入组」）。 */
    dropTarget: boolean;
    onPointerDown(event: React.PointerEvent, id: string): void;
    onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void;
    onMemberSelect(id: string): void;
    onResizeStart(event: React.PointerEvent, id: string, direction: string): void;
}
export declare function GroupCard({ node, copy, members, selected, dropTarget, onPointerDown, onHandlePointerDown, onMemberSelect, onResizeStart }: GroupCardProps): import("react").JSX.Element;
export {};
