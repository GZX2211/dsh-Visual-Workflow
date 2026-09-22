// src/host/api/file-download.ts
//
// 受管文件下载路由：GET /visual-workflow/files/<name> 返回受管文件内容（仅限受管
// 目录内，文件名严格 basename 校验防目录穿越）。
//
// 匹配序：webServer 固定 exact > longest prefix，'/visual-workflow/files' 长于
// '/visual-workflow'，GET 文件请求先命中本路由，POST 端点白名单不受影响。
// 受管文件的落盘入口在 storage 模块（data/files 布局与原子发布归其所有）。
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { managedFilePath } from '../storage/managed-files.js';
const MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.zip': 'application/zip',
};
function contentTypeOf(name) {
    return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
}
/**
 * 注册受管文件下载路由（GET /visual-workflow/files/<name>）。
 * 文件名必须是纯 basename（含路径分隔符一律 404）；文件缺失 404。
 */
export function registerDownloadRoute(ctx, dataDir) {
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function') {
        ctx.logger?.warn?.('[visual-workflow] webServer 服务不可用，受管文件下载路由未挂载');
        return () => { };
    }
    return webServer.register({
        kind: 'prefix',
        path: '/visual-workflow/files',
        async handler(req, res) {
            const httpReq = req;
            const httpRes = res;
            try {
                if (httpReq.method !== 'GET') {
                    httpRes.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
                    httpRes.end(JSON.stringify({ ok: false, error: { message: 'method not allowed; use GET' } }));
                    return;
                }
                const url = new URL(String(httpReq.url ?? '/'), 'http://localhost');
                const segments = url.pathname.split('/').filter(Boolean);
                const rawName = segments[segments.length - 1] ?? '';
                // 严格 basename 校验：路径内任何分隔符（含 URL 编码）一律拒绝
                if (!rawName || basename(rawName) !== rawName || rawName.includes('..') || rawName.includes('%')) {
                    httpRes.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    httpRes.end(JSON.stringify({ ok: false, error: { message: 'file not found' } }));
                    return;
                }
                let content;
                try {
                    content = await readFile(managedFilePath(dataDir, rawName));
                }
                catch {
                    httpRes.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    httpRes.end(JSON.stringify({ ok: false, error: { message: 'file not found' } }));
                    return;
                }
                httpRes.writeHead(200, {
                    'Content-Type': contentTypeOf(rawName),
                    'Content-Length': String(content.length),
                    'Cache-Control': 'no-store',
                });
                httpRes.end(content);
            }
            catch {
                httpRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                httpRes.end(JSON.stringify({ ok: false, error: { message: 'internal error' } }));
            }
        },
    });
}
//# sourceMappingURL=file-download.js.map