import * as EP from '../../host/shared/protocol.js';
export { EP };
/** 传输层超时错误码（client 侧专有；后端业务码见共享协议 ERR_* 常量）。 */
export declare const REMOTE_TIMEOUT_CODE = "REMOTE_TIMEOUT";
/** 非流式调用默认超时：覆盖启动服务/运行/导入导出等长耗时端点，仅收敛「永久悬挂」。 */
export declare const DEFAULT_REMOTE_TIMEOUT_MS = 120000;
/** 轮询专用短超时：单轮请求悬挂时必须尽快释放 in-flight 位，下一轮才能继续。 */
export declare const POLL_REMOTE_TIMEOUT_MS = 8000;
/** 携带稳定错误码的远端错误（code 可判定，调用方按语义分支）。 */
export interface RemoteError extends Error {
    code?: string;
}
/**
 * 乐观锁冲突判定（稳定错误码本体在共享协议常量）：保存路径据此走「冲突语义」
 * （刷新列表 + 明确提示用户重试），而不是仅展示通用 message 后静默继续。
 */
export declare function isRevisionConflict(error: unknown): boolean;
export interface RemoteCallOptions {
    /** 主动取消（卸载/切换文档/停止轮询时中止在途请求）。 */
    signal?: AbortSignal;
    /** 超时毫秒；0 = 不设超时（仅依赖 signal 取消）。缺省 DEFAULT_REMOTE_TIMEOUT_MS。 */
    timeoutMs?: number;
}
/** 调用 Host API（同源 fetch；超时与取消见 RemoteCallOptions）。 */
export declare function remoteCall(endpoint: string, args?: Record<string, unknown>, options?: RemoteCallOptions): Promise<unknown>;
/**
 * 流式调用 Host API（SSE 透传）：POST /visual-workflow/<endpoint>，把服务端
 * SSE 的 data 行文本逐行回调（解析归调用方）；流结束 resolve。
 * 非 2xx（未写流头）抛出后端 message（含稳定 code）；AbortError 静默返回（调用方主动停止）。
 * 说明：SSE 是长连接，不设整体超时——生命周期由调用方 signal 掌握（谁创建谁释放）。
 */
export declare function streamCall(endpoint: string, args: Record<string, unknown>, onLine: (line: string) => void, signal?: AbortSignal): Promise<void>;
