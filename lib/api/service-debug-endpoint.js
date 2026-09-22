// src/host/api/service-debug-endpoint.ts
//
// serviceDebug 流式端点实现（POST /visual-workflow/serviceDebug）：把浏览器发送的
// 调试问题转发到「运行中服务」，并以 SSE 把上游响应逐块透传回浏览器。
//
// 为什么与路由分发表分离：这里负责响应头与 SSE 帧格式、写头时机、浏览器断连时的
// 上游中止（AbortController 生命周期）；路由表只负责端点名分发与 JSON 契约。
import { httpError } from './http.js';
import { openServiceDebug, pumpServiceDebug } from './service-debug.js';
/**
 * 处理 serviceDebug 流式端点：先校验参数与服务运行态，再打开上游流并写 SSE 头。
 * 上游错误在未写头时以 JSON 错误透传（状态码层可见），已写头后以 SSE error 行收尾。
 */
export async function streamServiceDebugEndpoint(host, args, res, req) {
    const serviceId = String(args?.serviceId ?? '');
    const sessionId = String(args?.sessionId ?? '');
    const prompt = String(args?.prompt ?? '');
    if (!serviceId || !sessionId || !prompt.trim()) {
        throw httpError(400, 'requires serviceId, sessionId and prompt');
    }
    const manager = host.serviceManager;
    if (!manager)
        throw httpError(501, 'service manager unavailable');
    const status = (await manager.status(serviceId));
    if (status?.status !== 'running' || !status.port) {
        throw httpError(409, '服务未运行，请先启动服务', 'WF_SERVICE_NOT_RUNNING');
    }
    const controller = new AbortController();
    // 浏览器断连时中止转发（避免残留请求占用服务并发槽）
    if (typeof req.on === 'function') {
        req.on('close', () => controller.abort());
    }
    let headSent = false;
    try {
        // 先打开上游流并校验状态（401/400 等错误在写头前以 JSON 透传），再写 SSE 头
        const body = await openServiceDebug({ port: status.port, apiKey: host.apiKey ?? null, userId: `debug-${sessionId}` }, prompt, fetch, controller.signal);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
        });
        headSent = true;
        const sink = {
            write: (chunk) => {
                try {
                    res.write(chunk);
                }
                catch {
                    // 浏览器已断开：中止上游请求，交由收尾
                    controller.abort();
                }
            },
            end: () => {
                try {
                    res.end();
                }
                catch {
                    // 已断开：忽略
                }
            },
        };
        await pumpServiceDebug(body, sink, controller.signal);
    }
    catch (error) {
        if (error?.name === 'AbortError')
            return;
        if (headSent) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
            }
            catch {
                // 已断开：忽略
            }
            res.end();
            return;
        }
        throw error;
    }
}
//# sourceMappingURL=service-debug-endpoint.js.map