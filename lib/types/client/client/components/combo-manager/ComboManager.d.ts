import type { Dict } from '../../i18n.js';
import type { RemoteFace } from '../../hooks/useRemote.js';
export interface ComboManagerProps {
    copy: Dict;
    remote: RemoteFace;
    sessionId: string;
    onClose(): void;
    onToast(kind: 'info' | 'success' | 'error', text: string): void;
    /** 宿主侧组合快照刷新（返回的 Promise 失败时由本组件显式提示，不得静默吞掉）。 */
    onChanged(): void | Promise<unknown>;
}
export declare function ComboManager({ copy, remote, sessionId, onClose, onToast, onChanged }: ComboManagerProps): import("react").JSX.Element;
