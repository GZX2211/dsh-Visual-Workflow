import type { FlowStore } from '../storage/flow-store.js';
import type { OrchestratorRuntime } from '../orchestrator/runtime.js';
import type { RunStatus } from '../shared/types.js';
/** OpenAI 兼容错误（status 供 HTTP 层；type/code 供 error body）。 */
export declare class OpenAiError extends Error {
    readonly status: number;
    readonly type: string;
    readonly code: string;
    constructor(status: number, type: string, code: string, message: string);
}
/** 轮询间隔（流式增量刷新/终态检测）。 */
export declare const OPENAI_POLL_MS = 200;
/** SSE 文本块最大长度（打字机分块粒度；超长文本分多块）。 */
export declare const SSE_CHUNK_LIMIT = 120;
/** SSE 流式响应超时默认值（需求文档 §5：默认 5 分钟，可配置）。 */
export declare const DEFAULT_SSE_TIMEOUT_MS: number;
/** 客户端断开时的内部错误码（streamResponse 用于静默收尾）。 */
export declare const CLIENT_CLOSED_CODE = "client_closed";
export interface OpenAiApiDeps {
    /** 数据层（userId 映射/断点查找）。 */
    store: FlowStore;
    /** 编排运行时（startRun/resumeRun/runSnapshot）。 */
    orchestrator: OrchestratorRuntime;
    /** 服务 id（编排 flowId 与映射文件作用域）。 */
    serviceId: string;
    /** 鉴权密钥（null 关闭）。 */
    apiKey: string | null;
    /** 单服务并发请求上限（超出 429）。 */
    maxConcurrent: number;
    /** userId → sessionId（SessionMap.resolve）。 */
    resolveSession(userId: string): Promise<string>;
    /**
     * 新建会话（「服务级新会话」：服务文档 startNewSession=true 时每次请求新建
     * 独立会话运行，cwd=服务工作区路径；弱化同一 userId 的跨请求连续性）。
     * 缺省时回退 resolveSession（现有复用会话语义）。
     */
    createSession?(options: {
        label: string;
        agentPreset?: string;
        cwd?: string;
    }): Promise<string>;
    /** 按会话取/建根 Agent（服务进程内装配）。 */
    ensureRootAgent(sessionId: string): Promise<{
        agent: unknown;
        provider?: string;
        model?: string;
    }>;
    /** watchdog 单次推进（回合终态/空闲判定）。 */
    sweep(): Promise<void>;
    /** 轮询间隔（测试可控）。 */
    pollMs?: number;
    /** SSE 流式响应超时（毫秒；需求文档 §5 默认 5 分钟，缺省取默认值）。 */
    sseTimeoutMs?: number;
    /** 日志缝。 */
    logger?: {
        warn?(message: string): void;
    };
}
/** runChat 扩展选项（客户端断开信号 + 超时控制，Bug 22/23）。 */
export interface RunChatOptions {
    /** 客户端断开信号：aborted 时停止后台运行并抛 client_closed 错误。 */
    signal?: AbortSignal;
    /** 等待超时（毫秒）；缺省取 deps.sseTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS。 */
    timeoutMs?: number;
}
/** 解析后的聊天请求。 */
export interface ParsedChatRequest {
    userId: string;
    question: string;
    stream: boolean;
    model?: string;
}
/** 一次编排运行的结果。 */
export interface ChatRunResult {
    /** 父代理最终回答文本（流式/非流式同源）。 */
    text: string;
    /** run 终态（completed/failed/stopped/paused）。 */
    status: RunStatus;
    /** 运行 id（诊断）。 */
    runId: string;
    /** 失败时的错误描述。 */
    error?: string;
}
/** 解析并校验请求（鉴权在路由层经 headers 完成；此处校验 userId/messages）。 */
export declare function parseChatRequest(body: unknown, userIdFromHeader?: string): ParsedChatRequest;
/**
 * OpenAI 兼容 API 核心（纯逻辑可测；webServer 注册为薄壳）。
 */
export declare class OpenAiApi {
    private readonly deps;
    /** in-flight 请求计数（并发上限）。 */
    private inflight;
    constructor(deps: OpenAiApiDeps);
    /** 鉴权校验：apiKey 配置非空时要求 Authorization: Bearer <apiKey>。 */
    authorize(authorization: unknown): void;
    /** 获取并发槽；超限抛 429。返回释放函数（finally 必调）。 */
    acquire(): () => void;
    /** 执行一次编排请求（wait 循环 + 事件增量回调）。 */
    runChat(input: ParsedChatRequest, onDelta?: (delta: string) => void, options?: RunChatOptions): Promise<ChatRunResult>;
    /** GET /v1/models：服务模型信息（父代理节点模型；缺失返回空列表）。 */
    models(): Promise<{
        object: string;
        data: Array<{
            id: string;
            object: string;
            owned_by: string;
            created: number;
        }>;
    }>;
}
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
