import type { Dict } from '../../i18n.js';
import type { RemoteFace } from '../../hooks/useRemote.js';
export interface ComboManagerProps {
    copy: Dict;
    remote: RemoteFace;
    sessionId: string;
    onClose(): void;
    onToast(kind: 'info' | 'success' | 'error', text: string): void;
    onChanged(): void;
}
export declare function ComboManager({ copy, remote, sessionId, onClose, onToast, onChanged }: ComboManagerProps): import("react").JSX.Element;
