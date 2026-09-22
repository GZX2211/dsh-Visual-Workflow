import type { ApiHost } from './boundary.js';
/**
 * 处理 serviceDebug 流式端点：先校验参数与服务运行态，再打开上游流并写 SSE 头。
 * 上游错误在未写头时以 JSON 错误透传（状态码层可见），已写头后以 SSE error 行收尾。
 */
export declare function streamServiceDebugEndpoint(host: ApiHost, args: Record<string, unknown>, res: {
    writeHead(status: number, headers: Record<string, string>): unknown;
    write(chunk: string): unknown;
    end(body?: string): unknown;
}, req: {
    on?(event: string, listener: () => void): unknown;
}): Promise<void>;
