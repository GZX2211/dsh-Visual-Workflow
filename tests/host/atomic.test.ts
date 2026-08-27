// T-011 原子存储原语测试。
//
// 覆盖任务 DoD 要求的全部场景，且**全部在临时目录内运行、结束清理**（硬性要求）：
//   1. 原子写成功往返（内容一致、无 .tmp-* 残留）；
//   2. 并发写（Promise.all 多路并发写同一文件 → 最终为某次完整内容，无撕裂/无损坏/无垃圾）；
//   3. 崩溃恢复（残留临时文件 + 残留锁文件 → 清理 API / 下次写自动回收，可恢复读写）；
//   4. 陈旧锁回收（旧时间戳 + 已死 pid → acquire 回收成功；新鲜锁不被回收 → 并发另一实例失败）；
//   5. 锁互斥（两"实例"对同一路径，一个持有另一个等待/失败，按 API 语义断言）；
//   6. no-clobber（并发创建同一文件仅一方成功，断言不静默覆盖）。
//
// 运行环境：node（host 测试默认）。测试使用 os.tmpdir() + 随机子目录，afterEach 强制清理。

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CorruptJsonError,
  DiskLockError,
  acquireDiskLock,
  atomicReplaceFile,
  atomicWriteJson,
  cleanupStaleTemp,
  readJson,
  releaseDiskLock,
  withFileLock,
  withJsonLock,
} from '../../src/host/storage/atomic.js'

// ── 临时目录管理（每个用例独立随机子目录，结束强制删除）──────────────────

/** 本组所有用例使用的临时根目录列表（for afterEach 统一清理）。 */
const tmpRoots: string[] = []

/** 创建随机临时目录并登记，返回其绝对路径。 */
function makeTmpDir(): string {
  const root = join(tmpdir(), `dsh-vw-atomic-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  tmpRoots.push(root)
  return root
}

/** 写一个带已知内容与并发序号的 payload，便于断言「完整内容之一」。 */
function payload(i: number): Record<string, unknown> {
  return { seq: i, text: `content-${i}` }
}

/** 读目录下的条目名列表（含目录项？只取文件前缀），用于断言无垃圾残留。 */
async function listEntryNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** 断言目录中不存在任何 `.tmp` 开头的残留文件（崩溃恢复的核心断言之一）。 */
async function expectNoTmpResidue(dir: string): Promise<void> {
  const names = await listEntryNames(dir)
  expect(names.filter((n) => n.startsWith('.tmp')), '不应残留 .tmp 临时文件').toEqual([])
}

afterEach(async () => {
  // 并行清理所有登记的临时目录；失败不致命（清理尽力而为，避免掩盖用例断言）。
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => {})))
})

// ── 1. 原子写成功往返 ─────────────────────────────────────────────────────

describe('T-011 原子写 JSON：往返与无残留', () => {
  it('写入→读出内容一致，且无 .tmp-* 残留', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'state.json')
    const data = { a: 1, nested: { b: [2, 3], s: 'x' }, 中文: '值' }

    await atomicWriteJson(file, data)
    const read = await readJson<typeof data | null>(file, null)

    expect(read).toEqual(data)
    await expectNoTmpResidue(dir)
  })

  it('写入会带上换行结尾（人类可读约定）', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'state.json')
    await atomicWriteJson(file, { ok: true })
    const text = await readFile(file, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('写入自动创建不存在的父目录（mkdir recursive）', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'nested', 'deep', 'state.json')
    await atomicWriteJson(file, { ok: true })
    expect(await readJson(file, null)).toEqual({ ok: true })
  })
})

// ── 2. 原子读 ─────────────────────────────────────────────────────────────

describe('T-011 原子读 readJson：fallback 与损坏语义', () => {
  it('ENOENT 返回 fallback', async () => {
    const dir = makeTmpDir()
    const fallback = { defaulted: true }
    expect(await readJson(join(dir, 'missing.json'), fallback)).toBe(fallback)
  })

  it('损坏 JSON 抛 CorruptJsonError（带路径），不静默返回 fallback', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'corrupt.json')
    await writeFile(file, '{ not valid json', 'utf8')
    await expect(readJson(file, { fallback: 1 })).rejects.toBeInstanceOf(CorruptJsonError)
    await expect(readJson(file, { fallback: 1 })).rejects.toThrow(file)
  })
})

// ── 3. 并发写：多路并发，最终为某一次完整内容，无损坏无垃圾 ──────────────

describe('T-011 并发写：最终为某次完整内容、无撕裂、无垃圾', () => {
  it('Promise.all 多路并发写同一文件，读回为其中一次完整内容', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'shared.json')
    const n = 16
    // 组合 API：磁盘锁 + 进程内锁，保证串行。
    await Promise.all(
      Array.from({ length: n }, (_, i) => withJsonLock(file, () => atomicWriteJson(file, payload(i)), { timeoutMs: 5000 })),
    )
    const read = await readJson<Record<string, unknown> | null>(file, null)
    // 最终必然等于某一次 { seq: k, text: 'content-k' }（k ∈ [0,n)），且不是撕裂混合。
    expect(read).not.toBeNull()
    const seqValue = (read as Record<string, unknown>).seq
    expect(typeof seqValue).toBe('number')
    expect((read as Record<string, unknown>).text).toBe(`content-${seqValue}`)
    await expectNoTmpResidue(dir)
  })
})

// ── 4. 崩溃恢复：残留临时文件 + 残留锁文件 → 清理/自动回收 ──────────────

describe('T-011 崩溃恢复：残留临时文件与锁文件', () => {
  it('cleanupStaleTemp 清理残留 .tmp 临时文件（崩溃残留）', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'state.json')
    // 模拟崩溃：写一半留下的临时文件（内容任意，无目标文件）。
    const orphanTmp = join(dir, '.tmp-99999-deadbeefcafe')
    await writeFile(orphanTmp, 'partial', 'utf8')

    const cleaned = await cleanupStaleTemp(dir)
    expect(cleaned).toContain(orphanTmp)
    await expectNoTmpResidue(dir)

    // 清理后可正常读写（数据为上次成功发布版本）。
    await atomicWriteJson(file, { ok: 1 })
    expect(await readJson(file, null)).toEqual({ ok: 1 })
  })

  it('Bug 13：持有进程存活的 .tmp 临时文件不被清理（并发写不误删）', async () => {
    const dir = makeTmpDir()
    // 本测试进程即「活着」的写者：文件名带当前 pid，正等待 rename 的文件必须保留
    const alive = join(dir, `.tmp-${process.pid}-abcdef`)
    // 已死 pid 的崩溃残留 + 解析不出 pid 的畸形文件：应清理
    const dead = join(dir, '.tmp-99999999-deadbeef')
    const odd = join(dir, '.tmp-weird-suffix')
    await writeFile(alive, 'in-flight', 'utf8')
    await writeFile(dead, 'partial', 'utf8')
    await writeFile(odd, 'partial', 'utf8')

    const cleaned = await cleanupStaleTemp(dir)
    expect(cleaned).not.toContain(alive)
    expect(cleaned).toContain(dead)
    expect(cleaned).toContain(odd)
    // 活跃临时文件原样保留（并发写者的数据不被破坏）
    await expect(readFile(alive, 'utf8')).resolves.toBe('in-flight')
    await expect(readFile(dead, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('残留锁文件（持有 pid 已死）被 cleanupStaleTemp 回收，之后可正常获取锁', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'state.json')
    const lockPath = `${file}.lock`
    // 用「不可能存活」的极大 pid + 极旧 mtime 手工构造陈旧锁。
    await writeFile(lockPath, JSON.stringify({ pid: 999999999, createdAt: 0 }), 'utf8')
    // mtime 设为很久以前——但 cleanup 的回收依赖「pid 已死」+「mtime 超阈值」双条件；
    // mtime 用 utimes 强制回拨，确保超 DAC 默认 30s。
    const { utimes } = await import('node:fs/promises')
    await utimes(lockPath, new Date(0), new Date(0))

    const cleaned = await cleanupStaleTemp(dir)
    expect(cleaned).toContain(lockPath)

    // 锁已回收，可正常获取；获取后立即释放。
    const info = await acquireDiskLock(lockPath, { timeoutMs: 5000 })
    await releaseDiskLock(info)
  })

  it('恢复后可正常读写且数据为上次成功发布版本', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'state.json')
    // 先成功发布 v1。
    await atomicWriteJson(file, { ver: 1 })
    // 模拟崩溃残留：一个孤儿临时文件（对应一次未完成的写）。
    const orphanTmp = join(dir, '.tmp-1-aabbccddeeff')
    await writeFile(orphanTmp, '半写内容', 'utf8')

    // 下次写自动回收残留（atomicWriteJson 内部先 cleanup），随后正常发布 v2。
    await atomicWriteJson(file, { ver: 2 })
    expect(await readJson(file, null)).toEqual({ ver: 2 })
    await expectNoTmpResidue(dir)
  })
})

// ── 5. 陈旧锁回收 ─────────────────────────────────────────────────────────

describe('T-011 陈旧磁盘锁回收', () => {
  it('旧时间戳 + 已死 pid 的锁 → acquireDiskLock 能回收并成功获取', async () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, 'target.lock')
    await writeFile(lockPath, JSON.stringify({ pid: 999999999, createdAt: 0 }), 'utf8')
    const { utimes } = await import('node:fs/promises')
    await utimes(lockPath, new Date(0), new Date(0))

    const info = await acquireDiskLock(lockPath, { timeoutMs: 5000 })
    expect(info).toBeDefined()
    expect(info.pid).toBe(process.pid)
    // 成功后锁文件内容已更新为自己的 pid。
    const text = await readFile(lockPath, 'utf8')
    expect(JSON.parse(text).pid).toBe(process.pid)
    await releaseDiskLock(info)
  })

  it('新鲜锁不被回收（并发另一实例能获取失败）', async () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, 'fresh.lock')
    // 手工创建一个「新鲜」（mtime=现在）且「持有 pid 存活」（本进程 pid）的锁。
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8')

    // 用极短超时尝试获取：因持有者「活着」，锁不会被回收，应超时抛 DiskLockError。
    await expect(
      acquireDiskLock(lockPath, { timeoutMs: 80, pollIntervalMs: 10 }),
    ).rejects.toBeInstanceOf(DiskLockError)

    // 锁文件仍在，未被回收（新鲜锁保护）。
    expect(await readFile(lockPath, 'utf8')).toContain(String(process.pid))
  })
})

// ── 6. 锁互斥（跨实例语义）── 用「已死 pid 的陈旧锁 + 存活 pid 的新鲜锁」模拟 ─

describe('T-011 锁互斥', () => {
  it('一个实例持锁时，另一个实例等待超时失败（按 API 语义）', async () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, 'mutex.lock')
    // 实例 A 持锁。
    const a = await acquireDiskLock(lockPath, { timeoutMs: 5000 })
    expect(a.pid).toBe(process.pid)

    // 实例 B 尝试获取：应等待至超时抛 DiskLockError（A 的 pid 存活，B 不回收也拿不到）。
    await expect(
      acquireDiskLock(lockPath, { timeoutMs: 100, pollIntervalMs: 10 }),
    ).rejects.toBeInstanceOf(DiskLockError)

    // A 释放后 B 可获取成功。
    await releaseDiskLock(a)
    const b = await acquireDiskLock(lockPath, { timeoutMs: 5000 })
    await releaseDiskLock(b)
  })

  it('release 仅删除自己创建的锁（内容匹配校验）', async () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, 'own.lock')
    const a = await acquireDiskLock(lockPath, { timeoutMs: 5000 })
    // 模拟「锁被回收后由他人重建」（内容不同）。
    const someoneElsePayload = JSON.stringify({ pid: 1234, createdAt: Date.now() })
    await writeFile(lockPath, someoneElsePayload, 'utf8')

    // a 尝试释放：内容不匹配 → 不删除他人锁。
    await releaseDiskLock(a)
    expect(await readFile(lockPath, 'utf8')).toBe(someoneElsePayload)
    // 清理掉这个「他人锁」，维持测试卫生。
    await rm(lockPath, { force: true })
  })
})

// ── 7. no-clobber：并发创建同一文件仅一方成功 ────────────────────────────

describe('T-011 no-clobber：并发创建仅一方成功', () => {
  it('并发 acquireDiskLock 同一锁路径（open "wx"）仅一方成功，另一方超时', async () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, 'noclobber.lock')
    // 两个「实例」并发尝试创建同一锁：open('wx') 的 no-clobber 保证仅一方获胜。
    const results = await Promise.allSettled([
      acquireDiskLock(lockPath, { timeoutMs: 400, pollIntervalMs: 10 }),
      acquireDiskLock(lockPath, { timeoutMs: 400, pollIntervalMs: 10 }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    // 恰一方成功、一方超时（DiskLockError）；绝不会两方「同时认为」自己拿到了锁。
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DiskLockError)
    // 释放获胜方的锁，清理现场。
    const winner = fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireDiskLock>>>
    await releaseDiskLock(winner.value)
  })

  it('两个并发 atomicReplaceFile 目标不存在时，最终为某一方的完整内容（不静默混合）', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'only-one.json')
    // 两个写入者各自用唯一临时文件 + rename 发布；last-write-wins，但最终必为某个
    // 完整的 AAA 或 BBB，绝不会 AAABBB 或空/半截（原子替换的核心保证）。
    const results = await Promise.allSettled([
      atomicReplaceFile(file, Buffer.from('AAA')),
      atomicReplaceFile(file, Buffer.from('BBB')),
    ])
    // 至少一方成功（Windows 下瞬时 rename 锁竞争可能使一方获 EPERM/EBUSY，可接受）。
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    const text = await readFile(file, 'utf8')
    expect(['AAA', 'BBB']).toContain(text)
  })
})

// ── 8. 进程内锁 FIFO 公平与串行化 ─────────────────────────────────────────

describe('T-011 进程内文件锁 withFileLock', () => {
  it('同一路径的读改写串行化（后到者看到先到者的结果）', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'counter.json')
    await atomicWriteJson(file, { count: 0 })

    // 多个「读改写」任务并发执行：每个都读到当前 count 再 +1 写回。
    const n = 20
    const order: number[] = []
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        withFileLock(file, async () => {
          const state = await readJson<{ count: number }>(file, { count: 0 })
          const value = state.count
          order.push(i) // 记录执行进入顺序（用于 FIFO 断言辅助）
          await atomicWriteJson(file, { count: value + 1 })
        }),
      ),
    )
    const final = await readJson<{ count: number }>(file, { count: 0 })
    // 串行化保证无「丢更新」：并发 n 次 +1 最终必为 n。
    expect(final.count).toBe(n)
    // order 长度 = n，说明 n 个任务都执行过（无一被跳过）。
    expect(order.length).toBe(n)
  })

  it('同一路径锁 FIFO 公平：启动顺序与执行顺序一致', async () => {
    // 用一个可控的门，验证 FIFO：先入者先执行。
    const lockKey = join(makeTmpDir(), 'fifo-key')
    const executed: number[] = []
    let gate: Promise<void>
    let openGate!: () => void
    gate = new Promise<void>((r) => {
      openGate = r
    })

    const t1 = withFileLock(lockKey, async () => {
      await gate // 第一个持锁者阻塞，直到我们放行。
      executed.push(1)
    })
    const t2 = withFileLock(lockKey, async () => {
      executed.push(2)
    })

    // 放行第一个，二者都应完成，且顺序 1 → 2。
    openGate()
    await Promise.all([t1, t2])
    expect(executed).toEqual([1, 2])
  })
})

// ── 9. 组合 API withJsonLock 的端到端串行化 ───────────────────────────────

describe('T-011 组合 API withJsonLock', () => {
  it('磁盘锁 + 进程内锁 + 读改写原子性：并发自增无丢更新', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'combo.json')
    await atomicWriteJson(file, { n: 0 })
    const rounds = 25
    await Promise.all(
      Array.from({ length: rounds }, () =>
        withJsonLock(file, async () => {
          const state = await readJson<{ n: number }>(file, { n: 0 })
          await atomicWriteJson(file, { n: state.n + 1 })
        }, { timeoutMs: 5000 }),
      ),
    )
    expect((await readJson<{ n: number }>(file, { n: 0 })).n).toBe(rounds)
    // 无锁残留。
    await expectNoTmpResidue(dir)
    expect((await listEntryNames(dir)).filter((n) => n.endsWith('.lock'))).toEqual([])
  })

  it('fn 抛错时锁正常释放（不泄漏磁盘锁文件）', async () => {
    const dir = makeTmpDir()
    const file = join(dir, 'err.json')
    await expect(
      withJsonLock(file, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    // 锁已释放：可以再次获取。
    const info = await acquireDiskLock(`${file}.lock`, { timeoutMs: 5000 })
    await releaseDiskLock(info)
  })
})
