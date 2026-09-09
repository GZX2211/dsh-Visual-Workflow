import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
/** 轻提示展示时长。 */
export declare const TOAST_DURATION_MS = 2600;
export interface ToastFace {
    toast(kind: 'info' | 'success' | 'error', text: string): void;
    toastError(error: unknown): void;
}
/** 轻提示面（dispatch TOAST_PUSH/DROP；超时自动移除）。 */
export declare function useToast(dispatch: Dispatch<StudioAction>): ToastFace;
