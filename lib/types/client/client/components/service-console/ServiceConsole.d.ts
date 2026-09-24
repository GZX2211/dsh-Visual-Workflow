import type { Dict } from '../../i18n.js';
import type { ServiceState } from '../../../host/shared/types.js';
import type { ServiceDebugFace } from '../../hooks/useServiceDebugStream.js';
export interface ServiceConsoleProps {
    copy: Dict;
    service: ServiceState | null;
    busy: boolean;
    /** 服务调试流面（发送 / 停止 / 输出 / 进行中），由装配层注入。 */
    debug: ServiceDebugFace;
}
export declare function ServiceConsole({ copy, service, busy, debug }: ServiceConsoleProps): import("react").JSX.Element | null;
