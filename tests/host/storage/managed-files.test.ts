// tests/host/storage/managed-files.test.ts
//
// 受管文件写入回归测试（清单 P3：并发写同一受管文件的临时文件竞态）。
// 语义：同一目标的并发写入必须串行化后原子发布——最终内容恰为某一次完整写入、
// 无临时文件残留（发布原语与进程内锁归 storage 所有）。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyIntoManagedFile, managedFilePath } from '../../../src/host/storage/managed-files.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-download-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('copyIntoManagedFile 并发原子发布', () => {
  it('同一目标名的并发调用各写独立临时文件：最终内容为其中一次完整写入，无 .tmp 残留', async () => {
    const dir = await tempDir()
    const payloadA = Buffer.from('内容-A-'.repeat(200)).toString('base64')
    const payloadB = Buffer.from('内容-B-'.repeat(200)).toString('base64')
    // 同一文件名并发发起两次写入（模拟快速连续保存同模板）
    const results = await Promise.all([
      copyIntoManagedFile(dir, { name: 'shared.txt', base64: payloadA }),
      copyIntoManagedFile(dir, { name: 'shared.txt', base64: payloadB }),
    ])
    expect(results.map((r) => r.fileName)).toEqual(['shared.txt', 'shared.txt'])
    // 最终文件内容必须恰好等于某一次调用的完整内容（不允许交叉/截断）
    const final = await readFile(managedFilePath(dir, 'shared.txt'), 'utf8')
    expect([Buffer.from(payloadA, 'base64').toString('utf8'), Buffer.from(payloadB, 'base64').toString('utf8')]).toContain(final)
    // 临时文件全部清理（无残留）
    const leftovers = (await readdir(join(dir, 'data', 'files'))).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})