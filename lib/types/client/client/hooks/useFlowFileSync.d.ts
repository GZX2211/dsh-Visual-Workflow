import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 文件→画布同步轮询间隔（与 runStatus 轮询频率错开；2s 足够发现外部修改）。 */
export declare const FLOW_FILE_SYNC_MS = 2000;
/** 最近已同步的外部 revision（防止同一次外部修改重复提示）。 */
export declare function useFlowFileSync(state: StudioState, dispatch: Dispatch<StudioAction>, remote: RemoteFace, onExternalChange?: (message: string) => void): void;
