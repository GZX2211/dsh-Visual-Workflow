import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 轮询间隔（旧项目 RUN_POLL_MS）。当前固定 600ms；后端 runPollMs 配置键预留未接入。 */
export declare const RUN_POLL_MS = 600;
/** 运行轮询 effect：runId 变化起轮询；终态停。 */
export declare function useRunPolling(sessionId: string, runId: string | null, dispatch: Dispatch<StudioAction>, remote: RemoteFace): void;
