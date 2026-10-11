/** 请求体读取的最小结构（官方 webServer 的 req 收窄：只用 data/end/error/destroy）。 */
export interface BodyRequest {
    on(event: string, listener: (chunk?: unknown) => void): unknown;
    destroy?(): void;
}
/** JSON 响应写出的最小结构。 */
export interface JsonResponseSink {
    writeHead(status: number, headers: Record<string, string>): unknown;
    end(body: string): unknown;
}
/**
 * 请求流异常（读取过程中 req 的 `error` 事件）。
 * 用稳定的 name 而非 instanceof 单个模块实例来分类：调用方（两个边界）据此把
 * 「客户端请求体未完整送达」判为调用方错误，而不是内部故障（D05-01）。
 */
export declare class RequestStreamError extends Error {
    constructor(message: string);
}
/** 是否请求流异常（跨边界分类用）。 */
export declare function isRequestStreamError(error: unknown): boolean;
/**
 * 读取请求体为 UTF-8 文本。
 *
 * 超限即 reject（以调用方注入的 errorOf 构造错误）并 destroy 请求；`settled` 保证
 * 无论超限、结束还是异常，只结算一次（后续块不再进入缓冲）。
 * 注意：这里不承担「超限后仍在缓冲」的修复——现网两份实现都已在入缓冲前 return
 * （见 reports/audit/CROSS-CUTTING.md §3.1）；settled 只用于保证结算唯一。
 */
export declare function readRequestBody(req: BodyRequest, options: {
    limit: number;
    errorOf(limit: number): Error;
}): Promise<string>;
/** 写出 JSON 响应（两个边界的公共形态：UTF-8 + no-store）。 */
export declare function sendJsonResponse(res: JsonResponseSink, status: number, payload: unknown): void;
