/** 调试代理目标（运行中服务）。 */
export interface ServiceDebugTarget {
    /** 服务端口（serviceManager.status 返回）。 */
    port: number;
    /** 服务鉴权密钥（null 表示未启用；配置后转发 Bearer）。 */
    apiKey: string | null;
    /** 调试用 userId（`debug-<sessionId>`，隔离调试会话）。 */
    userId: string;
}
/** 流式写出缝（Node ServerResponse 的最小面）。 */
export interface SseSink {
    write(chunk: string): void;
    end(): void;
}
/** 调试代理错误（status 供路由层映射；已写头前 sendJson / 写头后 SSE error 行）。 */
export declare class ServiceDebugError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(status: number, message: string, code?: string);
}
/**
 * 发起调试请求：POST 上游 /v1/chat/completions（stream: true），校验响应状态后
 * 返回响应 body 流。非 2xx 抛 ServiceDebugError（调用方此时尚未写响应头，
 * 可返回标准 JSON 错误）。为什么先 fetch 再写头：上游鉴权/参数错误应在
 * HTTP 状态码层透传，而不是伪装成 SSE 错误流。
 */
export declare function openServiceDebug(target: ServiceDebugTarget, prompt: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
/**
 * 把上游 SSE body 逐块转发到 sink（原有字节透传；打字机粒度由上游控制）。
 * AbortError 视为用户停止，静默收尾。
 */
export declare function pumpServiceDebug(body: ReadableStream<Uint8Array>, sink: SseSink, signal?: AbortSignal): Promise<void>;
/** 转发一次调试请求（组合 open + pump；已写头场景用）。 */
export declare function streamServiceDebug(target: ServiceDebugTarget, prompt: string, sink: SseSink, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<void>;
