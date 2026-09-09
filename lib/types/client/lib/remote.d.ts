import * as EP from '../../host/shared/protocol.js';
export { EP };
/** 调用 Host API（同源 fetch）。 */
export declare function remoteCall(endpoint: string, args?: Record<string, unknown>): Promise<unknown>;
