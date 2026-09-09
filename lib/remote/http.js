// src/host/remote/http.ts
//
// GUI API 传输层基础：HttpError（带状态与稳定 code）、请求体读取（上限 413）、
// JSON 响应写出与请求体上限常量。路由层与端点分发共用。
/** 请求体上限（64MB——文件模板 base64 上传需要大体积）。 */
const BODY_LIMIT = 64 * 1024 * 1024;
/** HTTP 错误（status 供路由层写响应；code 供 client 分支处理）。 */
export class HttpError extends Error {
    status;
    code;
    constructor(status, message, code) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
    }
}
export function httpError(status, message, code) {
    return new HttpError(status, message, code);
}
/** 读取请求体（JSON 文本；超限 413）。 */
export function readBody(req, limit = BODY_LIMIT) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += Buffer.byteLength(String(chunk ?? ''));
            if (size > limit) {
                reject(httpError(413, 'request body too large'));
                req.destroy?.();
                return;
            }
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? '')));
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
export function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}
//# sourceMappingURL=http.js.map