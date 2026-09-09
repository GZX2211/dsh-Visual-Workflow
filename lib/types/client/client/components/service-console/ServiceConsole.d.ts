import type { Dict } from '../../i18n.js';
import type { ServiceState } from '../../../host/shared/types.js';
export interface ServiceConsoleProps {
    copy: Dict;
    service: ServiceState | null;
    /** 调试会话隔离（Host 侧组装 `debug-<sessionId>` userId）。 */
    sessionId: string;
    busy: boolean;
}
/**
 * 解析后端 SSE data 行的内容增量（Bug 3）。
 * 后端 openai-api 的 sseChunk 把正文放在 choices[0].delta.content；
 * 为兼容旧增量格式（delta.content）做回退取值。
 * @returns { content?, error? } 增量文本或错误消息（无匹配返回空对象）。
 */
export declare function parseSseDelta(data: string): {
    content?: string;
    error?: string;
};
export declare function ServiceConsole({ copy, service, sessionId, busy }: ServiceConsoleProps): import("react").JSX.Element | null;
