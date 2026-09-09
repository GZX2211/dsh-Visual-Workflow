import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
import type { RunControlFace } from './useRunControl.js';
import type { ServiceControlFace } from './useServiceControl.js';
import type { ToastFace } from './useToast.js';
import type { DocumentActionsFace } from './useDocumentActions.js';
import type { Dict } from '../i18n.js';
export interface RunActionsFace {
    startRun(): Promise<void>;
    stopRun(): Promise<void>;
    openHistory(): Promise<void>;
    resumeRun(runId: string): Promise<void>;
    startService(): Promise<void>;
    stopService(): Promise<void>;
}
/** 运行与服务控制面（远端失败抛错，由调用方 toast）。 */
export declare function useRunActions(state: StudioState, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], toastError: ToastFace['toastError'], t: Dict, remote: RemoteFace, runControl: RunControlFace, serviceControl: ServiceControlFace, saveCanvas: DocumentActionsFace['saveCanvas'], createInstanceFromCanvas: DocumentActionsFace['createInstanceFromCanvas']): RunActionsFace;
