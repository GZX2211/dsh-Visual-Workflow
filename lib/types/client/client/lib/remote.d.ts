import * as EP from '../../host/shared/protocol.js';
export { EP };
/** 调用 Host API（同源 fetch）。 */
export declare function remoteCall(endpoint: string, args?: Record<string, unknown>): Promise<unknown>;
/**
 * 流式调用 Host API（SSE 透传）：POST /visual-workflow/<endpoint>，把服务端
 * SSE 的 data 行文本逐行回调（解析归调用方）；流结束 resolve。
 * 非 2xx（未写流头）抛出后端 message；AbortError 静默返回（调用方主动停止）。
 */
export declare function streamCall(endpoint: string, args: Record<string, unknown>, onLine: (line: string) => void, signal?: AbortSignal): Promise<void>;
