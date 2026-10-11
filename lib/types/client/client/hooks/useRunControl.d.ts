import type { PrepareRuntimeInputs, RuntimeInputLifecycle } from "./use-runtime-inputs.js";
import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface RunControlFace {
    prepareInputs?: PrepareRuntimeInputs;
    inputLifecycle?: RuntimeInputLifecycle;
    /** 运行当前实例（会话 = 实例绑定的会话；存在断点自动续跑）。 */
    startRun(sessionId: string, flowId: string, configureInputs?: boolean, freshStart?: boolean): Promise<string | null>;
    /** 停止运行：携带实例归属会话 id 供后端归属校验（越权会话不得停止他人运行）。 */
    stopRun(sessionId: string, runId: string): Promise<void>;
}
/** 运行控制面（远端失败抛错，由调用方 toast）。 */
export declare function useRunControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace, prepareInputs?: PrepareRuntimeInputs, inputLifecycle?: RuntimeInputLifecycle): RunControlFace;
