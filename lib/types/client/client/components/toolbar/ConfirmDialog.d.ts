import type { Dict } from '../../i18n.js';
import type { ConfirmState } from '../../studio/studio-state.js';
export interface ConfirmDialogProps {
    t: Dict;
    confirm: ConfirmState | null;
    onClose(): void;
    /** 未保存守卫：保存并继续（save 由调用方注入）。 */
    onSaveAndProceed(): void;
    onDiscardAndProceed(): void;
}
export declare function ConfirmDialog({ t, confirm, onClose, onSaveAndProceed, onDiscardAndProceed }: ConfirmDialogProps): import("react").JSX.Element | null;
