// src/host/remote/download.ts
//
// 文件模板受管拷贝与下载路由：
//   - 受管拷贝：非文本文件模板保存时复制到 <dataDir>/data/files/（深拷贝解耦，
//     源文件删除后不失效），记录 managedPath；
//   - 下载路由：GET /visual-workflow/files/<name> 返回受管文件内容（仅限受管目录
//     内，文件名严格 basename 校验防目录穿越）。
//
// 匹配序：webServer 固定 exact > longest prefix，'/visual-workflow/files' 长于
// '/visual-workflow'，GET 文件请求先命中本路由，POST 端点白名单不受影响。

import { readFile, writeFile, copyFile, mkdir, rename } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'

/** 受管文件名消毒（只允许安全字符，防目录穿越）。 */
export function safeManagedName(name: string): string {
  const base = basename(String(name ?? '').trim()).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return base || `file-${Date.now().toString(36)}`
}

/** 受管文件绝对路径（data/files/<safeName>）。 */
export function managedFilePath(dataDir: string, name: string): string {
  return join(dataDir, 'data', 'files', safeManagedName(name))
}

/**
 * 受管拷贝：base64 内容或本地源文件 → data/files/<safeName>（原子发布）。
 * 返回受管相对路径（managedPath）与文件名。
 */
export async function copyIntoManagedFile(
  dataDir: string,
  input: { name: string; base64?: string; sourcePath?: string },
): Promise<{ managedPath: string; fileName: string }> {
  const fileName = safeManagedName(input.name)
  const target = managedFilePath(dataDir, fileName)
  await mkdir(join(dataDir, 'data', 'files'), { recursive: true })
  if (typeof input.base64 === 'string' && input.base64) {
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, Buffer.from(input.base64, 'base64'))
    await rename(temporary, target)
  } else if (typeof input.sourcePath === 'string' && input.sourcePath) {
    await copyFile(input.sourcePath, target)
  } else {
    throw new Error('需要 base64 内容或 sourcePath 源文件路径')
  }
  return { managedPath: join('data', 'files', fileName), fileName }
}

const MIME: Record<string, string> = {
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
}

function contentTypeOf(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 注册受管文件下载路由（GET /visual-workflow/files/<name>）。
 * 文件名必须是纯 basename（含路径分隔符一律 404）；文件缺失 404。
 */
export function registerDownloadRoute(
  ctx: { get(name: string): unknown; logger?: { warn?(message: string): void } },
  dataDir: string,
): () => void {
  const webServer = ctx.get('webServer') as
    | { register(route: { kind: 'exact' | 'prefix'; path: string; handler(req: unknown, res: unknown): Promise<void> | void }): () => void }
    | null
    | undefined
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[visual-workflow] webServer 服务不可用，受管文件下载路由未挂载')
    return () => {}
  }
  return webServer.register({
    kind: 'prefix',
    path: '/visual-workflow/files',
    async handler(req, res) {
      const httpReq = req as { method?: unknown; url?: unknown }
      const httpRes = res as { writeHead(status: number, headers: Record<string, string>): unknown; end(body: unknown): unknown }
      try {
        if (httpReq.method !== 'GET') {
          httpRes.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
          httpRes.end(JSON.stringify({ ok: false, error: { message: 'method not allowed; use GET' } }))
          return
        }
        const url = new URL(String(httpReq.url ?? '/'), 'http://localhost')
        const segments = url.pathname.split('/').filter(Boolean)
        const rawName = segments[segments.length - 1] ?? ''
        // 严格 basename 校验：路径内任何分隔符（含 URL 编码）一律拒绝
        if (!rawName || basename(rawName) !== rawName || rawName.includes('..') || rawName.includes('%')) {
          httpRes.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
          httpRes.end(JSON.stringify({ ok: false, error: { message: 'file not found' } }))
          return
        }
        let content: Buffer
        try {
          content = await readFile(managedFilePath(dataDir, rawName))
        } catch {
          httpRes.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
          httpRes.end(JSON.stringify({ ok: false, error: { message: 'file not found' } }))
          return
        }
        httpRes.writeHead(200, {
          'Content-Type': contentTypeOf(rawName),
          'Content-Length': String(content.length),
          'Cache-Control': 'no-store',
        })
        httpRes.end(content)
      } catch {
        httpRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        httpRes.end(JSON.stringify({ ok: false, error: { message: 'internal error' } }))
      }
    },
  })
}
