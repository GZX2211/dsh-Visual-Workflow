import type { DragPayload } from '../components/sidebar/LeftPanel.js';
import type { CanvasApi } from '../components/canvas/GraphCanvas.js';
export interface LibraryDragFace {
    beginLibraryDrag(event: React.PointerEvent, payload: DragPayload): void;
    dragPreview: {
        x: number;
        y: number;
        label: string;
    } | null;
    dropGroupId: string | null;
}
/** 左侧库拖拽面（canvasShellRef/canvasApiRef 供落点换算；payload 由 LeftPanel 注入）。 */
export declare function useLibraryDrag(canvasShellRef: React.RefObject<HTMLDivElement | null>, canvasApiRef: React.RefObject<CanvasApi | null>): LibraryDragFace;
