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
 * 注册 OpenAI 兼容路由（webServer 可用时挂载；disposer 随 fiber 注销）。
 * 端点：POST /v1/chat/completions、GET /v1/models。
 */
export declare function registerOpenAiApi(ctx: {
    get(name: string): unknown;
    logger?: {
        warn?(message: string): void;
    };
}, api: OpenAiApi): () => void;
