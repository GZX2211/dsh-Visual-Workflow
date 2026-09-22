/** HTTP 错误（status 供路由层写响应；code 供 client 分支处理）。 */
export declare class HttpError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(status: number, message: string, code?: string);
}
export declare function httpError(status: number, message: string, code?: string): HttpError;
/** 读取请求体（JSON 文本；超限 413）。 */
export declare function readBody(req: {
    on(event: string, listener: (chunk?: unknown) => void): unknown;
    destroy?(): void;
}, limit?: number): Promise<string>;
export declare function sendJson(res: {
    writeHead(status: number, headers: Record<string, string>): unknown;
    end(body: string): unknown;
}, status: number, payload: unknown): void;
