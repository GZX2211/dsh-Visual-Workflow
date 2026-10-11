import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 轮询间隔缺省（host 未下发时的回退值，即接入前的既有节奏）。 */
export declare const RUN_POLL_MS = 600;
/**
 * 解析 host 下发的轮询间隔。
 * 缺失 / 形态非法 / 非正数一律回退 RUN_POLL_MS：setInterval(0) 会退化成本地空转，
 * 下发值不可信时宁可持续用既有节奏（轮询是辅助路径：不停摆、也不加速）。
 */
export declare function resolveRunPollMs(value: unknown): number;
/** 运行轮询 effect：runId 变化起轮询；终态停。 */
export declare function useRunPolling(sessionId: string, runId: string | null, dispatch: Dispatch<StudioAction>, remote: RemoteFace): void;
