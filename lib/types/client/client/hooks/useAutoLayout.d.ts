import type { Dispatch } from 'react';
import type { CanvasNode, StudioAction, StudioState } from '../studio/studio-state.js';
/** 自动布局钩子依赖（全部可选注入，便于单测与「能力缺失即降级」）。 */
export interface AutoLayoutOptions {
    /** 画布保存入口（静默落盘；缺省则只更新本地画布，不落盘）。 */
    saveCanvas?: (options?: {
        auto?: boolean;
    }) => Promise<unknown> | void;
    /** 轻提示（重叠提示用；缺省静默）。 */
    notify?: (kind: 'info' | 'success' | 'error', text: string) => void;
    /** 提示文案（词典缺省时用内置中文）。 */
    tips?: {
        overlap?: string;
    };
    /** 布局完成后的视图回调（如自动适配视图；缺省不调用）。 */
    onApplied?: (nodes: CanvasNode[]) => void;
}
/**
 * 自动布局接线（每个「当前文档 id」只尝试一次；失败不阻断编辑）。
 * 与 tidyGraph 共用同一布局入口（lib/layout.ts），保证两条路径结果一致。
 */
export declare function useAutoLayout(state: StudioState, dispatch: Dispatch<StudioAction>, options?: AutoLayoutOptions): void;
