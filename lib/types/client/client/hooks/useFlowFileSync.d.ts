import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 文件→画布同步轮询间隔（与 runStatus 轮询频率错开；2s 足够发现外部修改）。 */
export declare const FLOW_FILE_SYNC_MS = 2000;
/** 外部修改提示文案（调用方从词典注入）。 */
export interface FlowFileSyncMessages {
    /** 工作流实例文件被外部修改。 */
    workflow: string;
    /** 服务实例文件被外部修改。 */
    service: string;
}
export declare function useFlowFileSync(state: StudioState, dispatch: Dispatch<StudioAction>, remote: RemoteFace, messages: FlowFileSyncMessages, onExternalChange?: (message: string) => void): void;
