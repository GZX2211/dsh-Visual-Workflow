import { OpenAiApi, OpenAiError } from './openai-api.js';
/** SSE 文本块最大长度（打字机分块粒度；超长文本分多块）。 */
export declare const SSE_CHUNK_LIMIT = 120;
/** SSE 数据行组装（OpenAI 兼容 chunk 形态）。 */
export declare function sseChunk(id: string, model: string, delta: string, finishReason: string | null): string;
/** SSE 结束标记行。 */
export declare function sseDone(): string;
/** SSE 错误行（流中异常收尾用）。 */
export declare function sseError(message: string): string;
/** 非流式成功响应体（OpenAI 兼容）。 */
export declare function completionJson(id: string, model: string, content: string): Record<string, unknown>;
/** 错误响应体。 */
export declare function errorJson(error: OpenAiError): Record<string, unknown>;
/**
 * 非 OpenAiError 异常 → OpenAI 兼容错误（本层唯一的错误映射点，纯函数）。
 * 分类口径（稳定语义，D05-01）：
 *   - 请求流异常（RequestStreamError）→ 400 invalid_request_error：客户端请求体未完整送达；
 *   - AbortError / TimeoutError → 499 client_error：请求已被取消；
 *   - 其余未知异常 → 500 server_error/internal_error（内部故障，供监控区分）。
 */
export declare function openAiErrorOf(error: unknown): OpenAiError;
/**
 * 注册 OpenAI 兼容路由（webServer 可用时挂载；disposer 随 fiber 注销）。
 * 端点：POST /v1/chat/completions、GET /v1/models。
 */
export declare function registerOpenAiApi(ctx: {
    get(name: string): unknown;
    logger?: {
        warn?(message: string): void;
    };
}, api: OpenAiApi): () => void;
