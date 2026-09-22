// src/host/service/openai-http.ts
//
// 模式二服务进程的 OpenAI 兼容 **HTTP 适配层**（webServer 官方 register 契约）：
//   POST /v1/chat/completions —— 流式（SSE 打字机）/ 非流式（完整 JSON）
//   GET  /v1/models           —— 服务信息（兼容客户端发现）
//
// 本层只做「HTTP 请求/响应 ⇄ 核心调用」的转换：方法校验、鉴权头、请求体读取与
// 限长、SSE 序列化、客户端断开信号、错误到 HTTP 状态与 error body 的映射。
// 编排语义一律在 ./openai-api.ts 的核心中，本层不含业务判断。
import { CLIENT_CLOSED_CODE, failureText, OpenAiApi, OpenAiError, parseChatRequest } from './openai-api.js';
/** 请求体上限（16MB，聊天文本足够）。 */
const BODY_LIMIT = 16 * 1024 * 1024;
/** SSE 文本块最大长度（打字机分块粒度；超长文本分多块）。 */
export const SSE_CHUNK_LIMIT = 120;
/** SSE 数据行组装（OpenAI 兼容 chunk 形态）。 */
export function sseChunk(id, model, delta, finishReason) {
    return `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { ...(delta ? { content: delta } : {}) }, finish_reason: finishReason }],
    })}\n\n`;
}
/** SSE 结束标记行。 */
export function sseDone() {
    return 'data: [DONE]\n\n';
}
/** SSE 错误行（流中异常收尾用）。 */
export function sseError(message) {
    return `data: ${JSON.stringify({ error: { message, type: 'server_error' } })}\n\n`;
}
/** 非流式成功响应体（OpenAI 兼容）。 */
export function completionJson(id, model, content) {
    return {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}
/** 错误响应体。 */
export function errorJson(error) {
    return { error: { message: error.message, type: error.type, code: error.code } };
}
function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}
/**
 * 注册 OpenAI 兼容路由（webServer 可用时挂载；disposer 随 fiber 注销）。
 * 端点：POST /v1/chat/completions、GET /v1/models。
 */
export function registerOpenAiApi(ctx, api) {
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function') {
        ctx.logger?.warn?.('[visual-workflow-service] webServer 服务不可用，OpenAI 兼容 API 未挂载');
        return () => { };
    }
    const disposers = [
        webServer.register({
            kind: 'exact',
            path: '/v1/chat/completions',
            async handler(req, res) {
                const httpReq = req;
                try {
                    if (httpReq.method !== 'POST') {
                        sendJson(res, 405, { error: { message: 'method not allowed', type: 'invalid_request_error' } });
                        return;
                    }
                    api.authorize(httpReq.headers?.authorization);
                    const body = await readBody(req);
                    let parsed;
                    try {
                        parsed = body.trim() ? JSON.parse(body) : {};
                    }
                    catch {
                        throw new OpenAiError(400, 'invalid_request_error', 'bad_request', 'invalid JSON body');
                    }
                    const headerUserId = headerValue(httpReq.headers?.['x-user-id']);
                    const input = parseChatRequest(parsed, headerUserId);
                    if (input.stream) {
                        await streamResponse(api, input, req, res);
                    }
                    else {
                        // 非流式同样支持客户端断开与 5 分钟超时（Bug 22/23）
                        const controller = new AbortController();
                        req?.on?.('close', () => controller.abort());
                        const release = api.acquire();
                        try {
                            const result = await api.runChat(input, undefined, { signal: controller.signal });
                            if (result.status !== 'completed') {
                                sendJson(res, 500, { error: { message: result.error ?? '编排运行失败', type: 'server_error' } });
                                return;
                            }
                            sendJson(res, 200, completionJson(`chatcmpl-${Date.now().toString(36)}`, input.model ?? 'workflow', result.text));
                        }
                        finally {
                            release();
                        }
                    }
                }
                catch (error) {
                    // 客户端已断开：不写任何响应
                    if (error instanceof OpenAiError && error.code === CLIENT_CLOSED_CODE)
                        return;
                    sendJson(res, error instanceof OpenAiError ? error.status : 500, errorJson(error instanceof OpenAiError ? error : new OpenAiError(500, 'server_error', 'internal_error', String(error instanceof Error ? error.message : error))));
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/v1/models',
            async handler(req, res) {
                const httpReq = req;
                if (httpReq.method !== 'GET') {
                    sendJson(res, 405, { error: { message: 'method not allowed', type: 'invalid_request_error' } });
                    return;
                }
                try {
                    sendJson(res, 200, await api.models());
                }
                catch (error) {
                    sendJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error), type: 'server_error' } });
                }
            },
        }),
    ];
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // 卸载尽力而为
            }
        }
    };
}
/** 流式响应：SSE 头 + 逐块 flush + [DONE] 收尾（监听客户端断开，Bug 23）。 */
async function streamResponse(api, input, req, res) {
    const release = api.acquire();
    const id = `chatcmpl-${Date.now().toString(36)}`;
    const model = input.model ?? 'workflow';
    const chunk = sseChunk;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
    });
    // 客户端断开监听：req 'close' 触发 AbortController → runChat 停止后台运行并抛
    // client_closed（否则恶意客户端断开后运行继续、并发槽被占满，Bug 23）。
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);
    try {
        const result = await api.runChat(input, (delta) => {
            if (controller.signal.aborted)
                return;
            for (let offset = 0; offset < delta.length; offset += SSE_CHUNK_LIMIT) {
                res.write(chunk(id, model, delta.slice(offset, offset + SSE_CHUNK_LIMIT), null));
            }
        }, { signal: controller.signal });
        if (controller.signal.aborted)
            return; // 客户端已断开：不再写任何 SSE
        if (result.status === 'completed') {
            res.write(chunk(id, model, '', 'stop'));
        }
        else {
            res.write(sseError(result.error ?? failureText(result.status, '')));
        }
        res.write(sseDone());
    }
    catch (error) {
        // 客户端断开场景静默收尾（连接已不存在，写响应无意义且可能抛错）
        if (error instanceof OpenAiError && error.code === CLIENT_CLOSED_CODE)
            return;
        try {
            res.write(sseError(error instanceof Error ? error.message : String(error)));
            res.write(sseDone());
        }
        catch {
            // 响应通道已失效：忽略（断开竞态）
        }
    }
    finally {
        release();
    }
    res.end();
}
/** 读取请求体（JSON 文本；超限 413 由调用方映射）。 */
function readBody(req, limit = BODY_LIMIT) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += Buffer.byteLength(String(chunk ?? ''));
            if (size > limit) {
                reject(new OpenAiError(413, 'invalid_request_error', 'body_too_large', 'request body too large'));
                req.destroy?.();
                return;
            }
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? '')));
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
/** header 取值归一（数组取首个）。 */
function headerValue(value) {
    if (Array.isArray(value))
        return value[0];
    return value;
}
//# sourceMappingURL=openai-http.js.map