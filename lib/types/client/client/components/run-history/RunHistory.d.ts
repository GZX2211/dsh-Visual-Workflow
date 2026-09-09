import type { Dict } from '../../i18n.js';
import type { RunSnapshot } from '../../../host/shared/types.js';
export interface RunHistoryProps {
    history: RunSnapshot[];
    selectedRunId: string | null;
    copy: Dict;
    onSelect(id: string): void;
    onClose(): void;
    onResume(runId: string): void;
    canResume: boolean;
}
export declare function RunHistory({ history, selectedRunId, copy, onSelect, onClose, onResume, canResume }: RunHistoryProps): import("react").JSX.Element;
