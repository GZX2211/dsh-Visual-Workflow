// tests/host/storage/managed-files.test.ts
//
// 受管文件写入回归测试（清单 P3：并发写同一受管文件的临时文件竞态）。
// 语义：同一目标的并发写入必须串行化后原子发布——最终内容恰为某一次完整写入、
// 无临时文件残留（发布原语与组合锁归 storage 所有）。
//
// 组合锁（磁盘锁在外 + 进程内锁在内）的跨进程语义：受管文件的两个写入者不在同一进程
// （宿主 GUI 上传 vs service-runner 服务进程），仅进程内锁无法互斥，故另有用例以
// 「外部持有的磁盘锁」为观测点。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyIntoManagedFile, managedFilePath } from '../../../src/host/storage/managed-files.js'
import { acquireDiskLock, releaseDiskLock } from '../../../src/host/storage/atomic.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-download-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 目录内指定后缀的残留文件（默认给受管文件目录）。 */
async function residueIn(dir: string, suffix: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(suffix))
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

  it('写入经组合锁：外部（另一进程语义）持有的磁盘锁未释放前，本进程的写入不会完成', async () => {
    const dir = await tempDir()
    const target = managedFilePath(dir, 'cross-process.bin')
    // 模拟「另一进程持有同一受管文件的写锁」：磁盘锁是跨进程事实，进程内锁看不见它。
    const info = await acquireDiskLock(`${target}.lock`)
    let writeSettled = false
    const write = copyIntoManagedFile(dir, { name: 'cross-process.bin', base64: Buffer.from('跨进程内容').toString('base64') })
      .then((value) => {
        writeSettled = true
        return value
      })
    try {
      // 观测窗口：此刻进程内锁是空闲的——若写入只依赖进程内锁，它早已完成
      const settledWhileHeld = await Promise.race([
        write.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
      ])
      expect(settledWhileHeld, '磁盘锁被外部持有时写入却完成了 → 说明未走跨进程锁').toBe(false)
    } finally {
      await releaseDiskLock(info)
    }
    await write
    expect(writeSettled).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('跨进程内容')
    // 成功路径不残留锁文件（与 .tmp 残留一并断言）
    expect(await residueIn(join(dir, 'data', 'files'), '.lock')).toEqual([])
    expect(await residueIn(join(dir, 'data', 'files'), '.tmp')).toEqual([])
  })

  it('源码级守卫：写入必须经组合锁原语，不得回退为仅进程内锁', async () => {
    const source = await readFile(new URL('../../../src/host/storage/managed-files.ts', import.meta.url), 'utf8')
    expect(source).toContain('withJsonLock')
    expect(source).not.toMatch(/await\s+withFileLock\(/)
  })
})