import type { Dispatch } from 'react';
import type { StudioAction, ConfirmState, StudioState } from '../studio/studio-state.js';
export interface UnsavedGuardFace {
    confirm: ConfirmState | null;
    /** 守卫包装：无未保存修改直接 proceed；否则弹确认框。 */
    guard(proceed: () => void): void;
    /**
     * 确认「保存并继续」：真实保存完成后才继续原操作。
     * @param save 保存执行体：必须把「真实落库成功」的回调（onSaved）接到自己的保存链上
     *   ——需要二次确认的路径（运行中实例保存）本次调用只返回 null，其落库发生在用户确认之后，
     *   由 onSaved 转达；未落库（待确认/失败/取消）一律不继续，dirty 保留。
     */
    saveAndProceed(save: (onSaved: () => void) => Promise<unknown>): Promise<void>;
    /** 确认「放弃并继续」。 */
    discardAndProceed(): void;
    /** 取消（关闭确认框）。 */
    cancel(): void;
}
/** 未保存守卫面（confirm 状态在 state 内）。 */
export declare function useUnsavedGuard(state: StudioState, dispatch: Dispatch<StudioAction>): UnsavedGuardFace;
