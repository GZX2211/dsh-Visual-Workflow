// tests/host/api/file-download.test.ts
//
// 受管文件下载路由（api/file-download.ts）：受管拷贝后 GET 返回内容、
// 目录穿越拒绝（404）、method 校验（405）。

import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { registerDownloadRoute } from '../../../src/host/api/index.js'
import { copyIntoManagedFile, managedFilePath } from '../../../src/host/storage/managed-files.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('受管文件下载路由', () => {
  it('受管拷贝与下载路由：GET 返回内容、目录穿越拒绝、405', async () => {
    const h = await makeHarness()
    const copied = await copyIntoManagedFile(h.dataDir, { name: 'doc.txt', base64: Buffer.from('受管内容').toString('base64') })
    expect(copied.fileName).toBe('doc.txt')
    const bytes = await readFile(managedFilePath(h.dataDir, 'doc.txt'), 'utf8')
    expect(bytes).toBe('受管内容')

    let registered: { handler: (req: unknown, res: unknown) => Promise<void> } | null = null
    h.ctx.services.set('webServer', {
      register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {}
      },
    })
    registerDownloadRoute({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.dataDir)
    expect(registered).toMatchObject({ handler: expect.any(Function) })

    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      end(body: string) {
        responses[responses.length - 1].body = String(body ?? '')
        return this
      },
    }
    await registered!.handler({ method: 'GET', url: '/visual-workflow/files/doc.txt' }, res)
    expect(responses[0].status).toBe(200)
    expect(responses[0].body).toBe('受管内容')

    await registered!.handler({ method: 'GET', url: '/visual-workflow/files/..%2Fsecret' }, res)
    expect(responses[1].status).toBe(404)

    await registered!.handler({ method: 'POST', url: '/visual-workflow/files/doc.txt' }, res)
    expect(responses[2].status).toBe(405)
  })

  it('webServer 缺失 → 告警并返回 no-op disposer（不抛错、不注册）', async () => {
    const h = await makeHarness()
    const warns: string[] = []
    const dispose = registerDownloadRoute({ get: (name) => h.ctx.get(name), logger: { warn: (message) => warns.push(message) } }, h.dataDir)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('webServer 服务不可用')
  })
})
