import type { Dispatch } from 'react';
import type { StudioAction, ConfirmState, StudioState } from '../studio/studio-state.js';
export interface UnsavedGuardFace {
    confirm: ConfirmState | null;
    /** 守卫包装：无未保存修改直接 proceed；否则弹确认框。 */
    guard(proceed: () => void): void;
    /** 确认「保存并继续」（save 失败则不继续）。 */
    saveAndProceed(save: () => Promise<unknown>): Promise<void>;
    /** 确认「放弃并继续」。 */
    discardAndProceed(): void;
    /** 取消（关闭确认框）。 */
    cancel(): void;
}
/** 未保存守卫面（confirm 状态在 state 内）。 */
export declare function useUnsavedGuard(state: StudioState, dispatch: Dispatch<StudioAction>): UnsavedGuardFace;
