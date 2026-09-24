import type { CanvasNode } from '../../studio/studio-state.js';
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
export interface Viewport {
    x: number;
    y: number;
    zoom: number;
}
export interface PanSession {
    startX: number;
    startY: number;
    originX: number;
    originY: number;
}
export interface CanvasViewportFace {
    /** 画布根元素（坐标换算与平移起点）。 */
    rootRef: React.RefObject<HTMLDivElement | null>;
    /** 当前视口（渲染 transform 用）。 */
    viewport: Viewport;
    /** 视口的最新值（事件回调里读取，避免闭包过期）。 */
    viewportRef: React.RefObject<Viewport>;
    updateViewport(value: Viewport | ((current: Viewport) => Viewport)): void;
    /** 适配视图（画布控制栏与自动布局共用）。 */
    fitView(options?: {
        padding?: number;
        nodes?: CanvasNode[];
    }): void;
    /** 平移会话（非空 = 正在平移，用于 cursor 与监听器生命周期）。 */
    panning: PanSession | null;
    beginPan(event: React.PointerEvent): void;
    zoomBy(factor: number): void;
    screenToWorld(clientX: number, clientY: number): {
        x: number;
        y: number;
    };
}
export declare function useCanvasViewport(nodes: CanvasNode[], onInit: (api: CanvasApi) => void): CanvasViewportFace;
