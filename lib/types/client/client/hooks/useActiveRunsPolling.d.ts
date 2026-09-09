import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 全量活跃 run 轮询间隔（列表徽标为概要信息，2s 足够；当前实例快照仍走 600ms 快轮询）。 */
export declare const ACTIVE_RUNS_POLL_MS = 2000;
/** 活跃 run 摘要条目（后端 activeRuns 全量返回；running/paused 保留锁）。 */
export interface ActiveRunItem {
    flowId: string;
    sessionId: string;
    status: string;
    runId: string;
}
/** 全量活跃 run 轮询 effect：挂载即拉一次，随后每 2s 刷新（卸载清理定时器）。 */
export declare function useActiveRunsPolling(dispatch: Dispatch<StudioAction>, remote: RemoteFace): void;
