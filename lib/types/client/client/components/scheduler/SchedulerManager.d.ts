import type { Dict } from '../../i18n.js';
import type { RemoteFace } from '../../hooks/useRemote.js';
export interface SchedulerManagerProps {
    copy: Dict;
    remote: RemoteFace;
    sessionId: string;
    onClose(): void;
    onToast(kind: 'info' | 'success' | 'error', text: string): void;
}
export declare function SchedulerManager({ copy, remote, sessionId, onClose, onToast }: SchedulerManagerProps): import("react").JSX.Element;
