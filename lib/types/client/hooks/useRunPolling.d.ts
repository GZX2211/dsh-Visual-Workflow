import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 轮询间隔（旧项目 RUN_POLL_MS）。 */
export declare const RUN_POLL_MS = 600;
/** 运行轮询 effect：runId 变化起轮询；终态停。 */
export declare function useRunPolling(runId: string | null, dispatch: Dispatch<StudioAction>, remote: RemoteFace): void;
