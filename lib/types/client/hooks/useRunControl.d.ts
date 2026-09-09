import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface RunControlFace {
    startRun(sessionId: string, flowId: string): Promise<string | null>;
    stopRun(runId: string): Promise<void>;
}
/** 运行控制面（远端失败抛错，由调用方 toast）。 */
export declare function useRunControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): RunControlFace;
