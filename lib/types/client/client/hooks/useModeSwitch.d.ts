import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
export interface ModeSwitchFace {
    setMode(mode: 'mode1' | 'mode2'): void;
}
/** 模式切换面（dispatch SET_MODE）。 */
export declare function useModeSwitch(dispatch: Dispatch<StudioAction>): ModeSwitchFace;
