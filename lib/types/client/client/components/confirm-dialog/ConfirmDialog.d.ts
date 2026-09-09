import type { ConfirmState } from '../../studio/studio-state.js';
import type { Dict } from '../../i18n.js';
interface ConfirmDialogProps {
    confirm: ConfirmState | null;
    copy: Dict;
    onClose(): void;
    onSaveAndProceed(): void;
    onDiscardAndProceed(): void;
    onResolveImport(mode: string): void;
}
export declare function ConfirmDialog({ confirm, copy, onClose, onSaveAndProceed, onDiscardAndProceed, onResolveImport }: ConfirmDialogProps): import("react").JSX.Element | null;
export {};
