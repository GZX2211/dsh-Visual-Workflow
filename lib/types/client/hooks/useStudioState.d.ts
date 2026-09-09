import { type StudioState } from '../studio/studio-state.js';
export interface StudioStateFace {
    state: StudioState;
    dispatch: React.Dispatch<import('../studio/studio-state.js').StudioAction>;
}
/** 主状态机（会话绑定：初始 sessionId 注入，后续由 SET_SESSION 更新）。 */
export declare function useStudioState(sessionId: string): StudioStateFace;
