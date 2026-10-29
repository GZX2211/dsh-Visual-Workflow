import type { Dict } from '../../i18n.js';
import type { RemoteFace } from '../../hooks/useRemote.js';
export interface SchedulerManagerProps {
    copy: Dict;
    remote: RemoteFace;
    sessionId: string;
    /** 桌面端文件路径桥（Web 端缺省）：条件脚本选择需要把 File 解析为绝对路径。 */
    filePathResolver?: (file: File) => string;
    onClose(): void;
    onToast(kind: 'info' | 'success' | 'error', text: string): void;
}
export declare function SchedulerManager({ copy, remote, sessionId, filePathResolver, onClose, onToast }: SchedulerManagerProps): import("react").JSX.Element;
