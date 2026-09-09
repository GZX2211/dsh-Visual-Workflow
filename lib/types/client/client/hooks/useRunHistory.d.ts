import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface RunHistoryFace {
    loadHistory(flowId: string): Promise<void>;
    /** 断点续跑（runId 缺省取该工作流最近可恢复记录）。 */
    resumeRun(sessionId: string, flowId: string, runId?: string): Promise<string | null>;
}
/** 运行历史面（远端失败抛错，由调用方 toast）。 */
export declare function useRunHistory(dispatch: Dispatch<StudioAction>, remote: RemoteFace): RunHistoryFace;
