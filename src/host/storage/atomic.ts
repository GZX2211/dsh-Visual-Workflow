// 原子存储原语（T-011）——T-012（FlowStore）与后续所有持久化的地基。
//
// 本模块提供六个能力，全部纯 Node 内建模块（W-05：零 @deepseek-ai/* 运行时依赖）：
//   1. atomicWriteJson       —— 同目录临时文件 + fsync + 原子发布的 JSON 写入。
//   2. readJson<T>           —— 原子读；ENOENT 返回 fallback；损坏 JSON 抛带路径的错误。
//   3. withFileLock          —— 进程内按路径 FIFO 互斥队列（读改写串行化）。
//   4. acquireDiskLock / releaseDiskLock —— 跨进程磁盘锁（open 'wx' no-clobber + 陈旧锁回收）。
//   5. withJsonLock          —— 磁盘锁 + 进程内锁 + 读改写原子性（供 FlowStore 直接使用）。
//   6. atomicReplaceFile     —— 通用二进制/文本原子替换（供后续非 JSON 文件用）。
//
// 设计为何如此（与官方取证结论对应，详见报告）：
//   - 官方 session-persistence-jsonl 用「link()+unlink() no-clobber」发布新文件，
//     因为日志是 append-only 且「首次物化」必须拒绝静默覆盖（README L45、L76）。
//     但它用「rename 覆盖」发布同单元整文件重写（storage-json README L9、atomic.ts L34），
//     因为单写者整文件替换时 last-write-wins 是正确语义。
//   - 本插件的数据形态是 FlowStore 的「整文件 JSON 重写 + 磁盘锁串行化」，属后者。
//     因此发布采用「rename 覆盖」，但必须结合磁盘锁（acquireDiskLock）保证跨进程只有一个
//     写者；进程内再叠 withFileLock 保证并发写串行。三者组合后，rename 的静默覆盖
//     「恰好不会发生」——覆盖发生时，目标只可能是本锁持有者刚发布的完整性版本。
//   - Windows 不存在 POSIX 的 link()+unlink() no-clobber 原语；官方对「拒绝覆盖」的
//     Windows 等价协议是 open(target,'wx')（open O_CREAT|O_EXCL → CREATE_NEW，Node 文档
//     明确其跨进程原子性）。本模块的磁盘锁与临时文件创建都依赖 open('wx')，语义安全。
//
// 原子发布协议（每个 API 各自注释「为什么」，这里只给总纲）：
//   同目录临时文件（唯一后缀，避免与并发写者互踩）→ 写内容 → fsync 文件句柄
//   → 原子发布（rename 覆盖，结合磁盘锁后无竞态）→ POSIX fsync 父目录（Windows 跳过，
//   官方 win32.ts L1-12 说明 Windows 不暴露父目录 fsync 契约）。失败路径必定清理临时文件，
//   绝不残留垃圾。

import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

// ── 默认参数（可经 opts 注入覆盖，便于测试）──────────────────────────────
// 锁默认超时（SKILL §4.6「获取失败重试」；需求按「有限次数/超时后抛明确错误」）。
const DEFAULT_LOCK_TIMEOUT_MS = 30_000
// 陈旧磁盘锁回收阈值（任务指定默认 30s）：锁文件 mtime 超过该阈值且持有 pid 已死才回收。
const DEFAULT_STALE_LOCK_MS = 30_000
// 磁盘锁获取的轮询间隔（避免忙等消耗 CPU；间隔小以保证测试快速）。
const DEFAULT_LOCK_POLL_MS = 20
// 临时文件前缀（同目录唯一后缀 `.tmp-<pid>-<rand>`，便于崩溃恢复按前缀识别残留）。
const TEMP_PREFIX = '.tmp'

// ── 错误类型（带明确 code，供上层按语义分支）──────────────────────────────

/** 磁盘锁获取超时/耗尽重试后抛出的明确错误。 */
export class DiskLockError extends Error {
  /** 锁文件路径（便于诊断）。 */
  readonly lockPath: string
  constructor(message: string, lockPath: string) {
    super(message)
    this.name = 'DiskLockError'
    this.lockPath = lockPath
  }
}

/** readJson 遇到损坏 JSON（UTF-8 可读但无法解析）时抛出的带路径错误。 */
export class CorruptJsonError extends Error {
  /** 目标文件路径。 */
  readonly filePath: string
  constructor(filePath: string, cause: unknown) {
    super(`损坏的 JSON 文件：${filePath}（解析失败：${(cause as Error | null)?.message ?? String(cause)}）`)
    this.name = 'CorruptJsonError'
    this.filePath = filePath
  }
}

// ── 通用小工具 ────────────────────────────────────────────────────────────

/** 判断错误是否为 ENOENT（文件/路径不存在）。其余任何非 ENOENT 失败都必须上浮。 */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** 判断错误是否为 EEXIST（no-clobber 创建冲突）。 */
function isEEXIST(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

/** 判断 Windows 报告「文件不存在」的变体 code（跨平台路径存在的鲁棒处理）。 */
function isAbsent(error: unknown): boolean {
  return isENOENT(error) || (error as NodeJS.ErrnoException | null)?.code === 'ENOTDIR'
}

/** POSIX 独有：fsync 目录，使刚 rename/link 的新目录项在掉电后仍存活。Windows 跳过。 */
async function fsyncDirectory(dir: string): Promise<void> {
  // Windows 不暴露父目录 fsync 契约（官方 win32.ts L1-12 的说明）；其耐久性由
  // MoveFileExW(MOVEFILE_WRITE_THROUGH) 承担，而 Node 的 rename 在 Windows 上经 libuv
  // 映射到 MoveFileExW（官方 atomic.ts L5-6）。故这里只在 POSIX 上补目录 fsync。
  if (process.platform === 'win32') return
  const handle = await open(dir, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** 解析 opts 中的临时目录（显式注入优先，便于测试与隔离）。 */
function resolveTmpDir(opts: TmpOptions | undefined): string | undefined {
  const dir = opts?.tmpDir
  return dir === undefined ? undefined : resolve(dir)
}

/** 清空锁元数据里的 pid 字段（用于陈旧锁判定）。 */
function readPid(meta: unknown): number | undefined {
  const pid = (meta as { pid?: unknown } | null)?.pid
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : undefined
}

// ── 公共类型 ──────────────────────────────────────────────────────────────

/** 原子写 JSON 的选项（全部可注入，便于测试与覆盖）。 */
export interface AtomicWriteJsonOptions {
  /** 显式临时目录（默认与目标同目录）。 */
  tmpDir?: string
  /** 换行符（默认 '\n'）。 */
  eol?: string
  /** 缩进（JSON.stringify 第三参，默认 2）。 */
  spaced?: number
}

/** 磁盘锁获取选项。 */
export interface DiskLockOptions {
  /** 获取成功/超时上限（毫秒）。超时抛 DiskLockError。 */
  timeoutMs?: number
  /** 陈旧锁回收阈值（毫秒）：锁 mtime 超此且 pid 已死才回收。 */
  staleAfterMs?: number
  /** 轮询间隔（毫秒）。 */
  pollIntervalMs?: number
  /** 注入自定义轮询/计时器（便于测试用假时钟加速）。 */
  now?: () => number
}

/** 临时目录相关选项（atomicReplaceFile）。 */
export interface TmpOptions {
  /** 显式临时目录。 */
  tmpDir?: string
}

/** 原子替换通用选项。 */
export interface AtomicReplaceOptions extends TmpOptions {}

/** releaseDiskLock 返回的锁信息。 */
export interface DiskLockInfo {
  /** 锁文件路径。 */
  lockPath: string
  /** 写入锁文件的元数据原始字符串（release 时校验内容匹配）。 */
  payload: string
  /** 当前进程 pid。 */
  pid: number
  /** 创建时间戳（epoch 毫秒）。 */
  createdAt: number
}

// ── 1. 原子写 JSON ────────────────────────────────────────────────────────

/**
 * 原子写 JSON（task：writeState 的改造版）。协议（每步「为什么」）：
 *   1. 确保目标目录存在（mkdir recursive）。
 *   2. 在目标**同目录**写临时文件（唯一后缀），用 open('wx') 独占创建（跨进程安全）；
 *      写入 UTF-8 字符串 + 换行，然后 fsync 文件**句柄**，保证字节落盘后再发布。
 *   3. 原子发布：`rename(tmp, target)` 覆盖目标。之所以敢用覆盖语义而非 no-clobber，
 *      是因为本 API 的调用方（withJsonLock）总是持磁盘锁 + 进程内锁后单写者执行；
 *      无锁裸调用时，rename 覆盖在 POSIX/Windows 均为原子替换，读者要么看旧版要么看新版，
 *      绝不会看到撕裂中间态（这正是「原子读」能读到完整内容的前提）。
 *   4. POSIX 补 fsync 父目录，Windows 跳过（见 fsyncDirectory 注释）。
 *   5. 任何失败路径 finally 清理临时文件（force），绝不残留垃圾。
 *
 * @param filePath 目标 JSON 文件绝对路径。
 * @param data 要写的数据（任意可 JSON.stringify 的值）。
 * @param opts 可注入临时目录/换行/缩进。
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  opts?: AtomicWriteJsonOptions,
): Promise<void> {
  const target = resolve(filePath)
  const targetDir = dirname(target)
  await mkdir(targetDir, { recursive: true })
  // 崩溃恢复：写前先清理同目录残留的临时文件与陈旧锁（「下次写自动回收」，需求允许的
  // 第二种恢复手段）。清理是幂等且保守的（只动 .tmp 残留与 pid 已死的陈旧锁），
  // 额外的 readdir 开销换取「崩溃后无需人工介入即自愈」。
  await cleanupStaleTemp(targetDir)
  const text = JSON.stringify(data, undefined, opts?.spaced ?? 2) + (opts?.eol ?? '\n')
  await atomicReplaceFile(target, Buffer.from(text, 'utf8'), { tmpDir: opts?.tmpDir })
}

// ── 2. 原子读 ─────────────────────────────────────────────────────────────

/**
 * 读 JSON。语义决策（task 要求注释说明）：
 *   - ENOENT / ENOTDIR 视为「不存在」，返回 fallback（幂等：首次读即缺省态）。
 *   - 其余读取失败（EACCES 等）不吞，原样上浮。
 *   - 文件存在但解析失败（损坏 JSON）：**抛出** CorruptJsonError（带路径信息），由上层决定
 *     如何处置（跳过/回退/报错）——静默 fallback 会把「数据损坏」伪装成「数据不存在」，
 *     违背需求 §5「数据一致性」的可诊断性；不抛则无法区分两者。
 *
 * @param filePath 目标文件路径。
 * @param fallback 文件不存在时返回的默认值。
 */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  const target = resolve(filePath)
  let content: string
  try {
    content = await readFile(target, 'utf8')
  } catch (error) {
    if (isAbsent(error)) return fallback
    throw error
  }
  try {
    return JSON.parse(content) as T
  } catch (error) {
    throw new CorruptJsonError(target, error)
  }
}

// ── 3. 进程内文件锁 ────────────────────────────────────────────────────────

// 进程级按路径的互斥队列（模块级 Map，跨 FlowStore 实例共享，保证同一进程内唯一性）。
const inProcessLocks = new Map<string, Promise<void>>()

/**
 * 进程内按路径 FIFO 互斥锁：保证同一进程内对同一路径的读改写串行化。
 * 实现（与旧项目 flow-store.js L110-125 withLock 同构，改造点见报告）：
 *   每个路径维护一条 Promise 链尾（Map<string, Promise>）；新任务 await 链尾后再执行，
 *   链尾 FIFO 顺序推进——后到者排队，先到者先执行（公平）。
 *   finally 里无论成败都释放当前链节；链尾引用即当前节时才删除 Map 条目，避免
 *   出现「新排队任务基于旧尾」的悬挂条目。
 *
 * @param path 文件路径（用作互斥键；建议传 resolve 后的绝对路径）。
 * @param fn 持锁期间执行的读改写任务。
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = inProcessLocks.get(path) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  const tail = previous.then(() => gate)
  inProcessLocks.set(path, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    // 仅当链尾仍是当前节时才删除，避免删除后被后续排队的旧引用悬挂。
    if (inProcessLocks.get(path) === tail) inProcessLocks.delete(path)
  }
}

// ── 4. 磁盘锁（跨进程互斥）────────────────────────────────────────────────

/**
 * 尝试创建锁文件（no-clobber 协议）。
 * `open(lockPath, 'wx')` = O_CREAT|O_EXCL：目标已存在即失败 EEXIST（Node 文档明确其
 * 按单次原子检查创建，跨进程安全）。锁内容为「owner pid + 创建时间戳」的 JSON 元数据，
 * 供陈旧锁回收判定与 release 的内容匹配校验。create 后 fsync 句柄保证元数据落盘。
 * @returns 成功返回元数据 payload 与时间戳；EEXIST 返回 null（未获取）；其余错误上浮。
 */
async function tryCreateLockFile(lockPath: string, now: () => number): Promise<DiskLockInfo | null> {
  const pid = process.pid
  const createdAt = now()
  const payload = JSON.stringify({ pid, createdAt })
  let handle
  try {
    handle = await open(lockPath, 'wx', 0o600)
  } catch (error) {
    // 目标已存在只意味着「锁被他人持有」，非错误；其余失败（EACCES/ENOENT 等）上浮。
    if (isEEXIST(error)) return null
    throw error
  }
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return { lockPath, payload, pid, createdAt }
}

/**
 * 检测并回收陈旧磁盘锁。为什么必须「删除前重新 stat 确认仍是同一锁文件」：
 *   锁文件 mtime 超阈值 ≠ 锁定「陈旧」。锁定可能刚被上一持有者释放、又立即被新持有者
 *   以同一路径重新创建（新 mtime 会更新，但存在竞态窗口）。若直接 rm(lockPath) 而不先
 *   stat 确认，可能误删**另一位刚拿到锁的持有者**的文件。因此回收逻辑：
 *     1. stat 锁文件取 mtimeMs 与 size；
 *     2. mtime 未超 staleAfterMs → 非陈旧，不回收（返回 false）；
 *     3. 读锁内容解析 owner pid；pid 存活（isProcessAlive 为 true）→ 持有者仍活着，
 *        视为「活跃锁」，不回收（哪怕 mtime 很旧——可能是长事务持有）；
 *     4. pid 已死 → 认定陈旧。删除前**重新 stat** 一次，确认 mtimeMs/size 与步骤 1
 *        完全一致（仍是同一文件、期间未被替换），才 rm。不一致则放弃本次回收，留待重试。
 *   删除用 rm(force)，理论上同路径被抢建会把它也删掉——但 size+mtime 双重比对把
 *   这个窗口缩到 stat 与 rm 之间极窄的竞态；若真发生，被误删者下次获取会重新建锁，
 *   语义上等价于「锁丢失」，可接受（详见报告「风险遗留」）。
 */
async function tryReapStaleLock(
  lockPath: string,
  staleAfterMs: number,
  now: () => number,
): Promise<boolean> {
  let info
  try {
    info = await stat(lockPath)
  } catch (error) {
    // 锁已消失：视为无需回收（获取方会立即成功创建）。
    if (isAbsent(error)) return false
    throw error
  }
  const mtimeMs = info.mtimeMs
  if (now() - mtimeMs < staleAfterMs) return false // 未超阈值：新鲜锁，不动。
  // 解析 owner pid：内容损坏（半写）视为「无有效 owner」，可回收。
  let pid: number | undefined
  try {
    const text = await readFile(lockPath, 'utf8')
    pid = readPid(JSON.parse(text))
  } catch {
    pid = undefined
  }
  if (pid !== undefined && isProcessAlive(pid)) return false // 持有者还活着：活跃锁，不动。
  // 删除前重新 stat 确认仍是同一锁文件（防误删刚被新持有者替换的锁）。
  const after = await stat(lockPath).catch(() => null)
  if (after === null) return false // 已消失，无需回收。
  if (after.mtimeMs !== mtimeMs || after.size !== info.size) return false // 期间被替换，放弃。
  await rm(lockPath, { force: true })
  return true
}

/** 判断进程是否存活。Windows 下 process.kill(pid,0) 对已死 pid 抛 ESRCH；其余平台同。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    // ESRCH = 进程不存在；EPERM = 存在但无权（仍视为存活，避免误回收同用户其他进程）。
    return code === 'EPERM'
  }
}

/**
 * 获取磁盘锁（跨进程互斥）。协议：
 *   循环「尝试 no-clobber 创建」→ 失败则检查是否可回收陈旧锁并回收 → 有限次重试，
 *   timeoutMs 超时后抛 DiskLockError。重试间隔 pollIntervalMs，用注入的 now() 计时（可假时钟加速）。
 *  为何「重试」而非「抛 EEXIST」：磁盘锁的使用方（withJsonLock）需要串行化读改写，
 *   正常等待语义（就像进程内 withFileLock 的排队）比立即失败更符合「保证串行」的目标；
 *   等待是有限的，超时抛明确错误避免死等。
 *
 * @param lockPath 锁文件路径（建议 `<数据文件路径>.lock`）。
 * @param opts 超时/陈旧阈值/轮询间隔/时钟注入。
 * @returns 锁信息（供 releaseDiskLock 校验与删除）。
 */
export async function acquireDiskLock(lockPath: string, opts?: DiskLockOptions): Promise<DiskLockInfo> {
  const target = resolve(lockPath)
  await mkdir(dirname(target), { recursive: true })
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE_LOCK_MS
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_LOCK_POLL_MS
  const now = opts?.now ?? Date.now
  const startedAt = now()
  for (;;) {
    const info = await tryCreateLockFile(target, now)
    if (info !== null) return info
    // 未获取：若存在陈旧锁则回收（删除后即可重试创建）；非陈旧则等待下一轮。
    await tryReapStaleLock(target, staleAfterMs, now)
    if (now() - startedAt >= timeoutMs) {
      throw new DiskLockError(
        `获取磁盘锁超时（${timeoutMs}ms）：${target}`,
        target,
      )
    }
    await sleep(pollIntervalMs)
  }
}

/** 轮询等待（最小注入：Node 定时器；测试用假时钟可更快，生产 pollIntervalMs 很小）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

/**
 * 释放磁盘锁：仅删除「自己创建」的锁（校验内容匹配）。
 * 为什么必须校验内容而非无条件删除：若锁已被回收又被他方重建，无条件删除会误删他人锁。
 * 因此先读当前锁内容，与持有时的 payload 逐字比对，一致才 rm；不一致 → 说明锁已易主，
 * 视为「已释放或非本进程持有」，静默返回（不强删，保守安全）。
 *
 * @param info acquireDiskLock 返回的锁信息。
 */
export async function releaseDiskLock(info: DiskLockInfo): Promise<void> {
  try {
    const current = await readFile(info.lockPath, 'utf8')
    if (current === info.payload) {
      await rm(info.lockPath, { force: true })
    }
    // 内容不匹配：锁已易主（被回收后重建），不做任何事，避免误删、避免失败。
  } catch (error) {
    // 锁文件已不存在（ENOENT）：本就无需释放。
    if (isAbsent(error)) return
    throw error
  }
}

// ── 5. 组合 API ────────────────────────────────────────────────────────────

/**
 * 磁盘锁 + 进程内锁 + 读改写原子性（供 FlowStore 直接使用）。
 * 锁顺序（避免死锁，必须固定）：
 *   先磁盘锁（跨进程互斥，窗口最大）→ 再进程内锁（同进程排队）→ 执行 fn → 释放。
 *   —— 若先进程内锁后磁盘锁，同进程两个线程可能相互锁住（A 持内存锁等 B 的磁盘锁，
 *   B 持有盘锁等 A 的内存锁）。固定「盘锁在外、内存锁在内」即无环。
 * 磁盘锁路径 = `<filePath>.lock`（与数据文件同目录，崩溃残留可被 cleanupStaleTemp 一并识别）。
 * 典型用法：withJsonLock(path, async () => { const s = await readJson(path, {}); ...; await atomicWriteJson(path, s) })
 *
 * @param filePath 数据文件路径（进程内锁键与磁盘锁派生路径都基于它）。
 * @param fn 持锁执行的读改写任务。
 * @param opts 透传给 acquireDiskLock 的超时/陈旧阈值。
 */
export async function withJsonLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
  opts?: DiskLockOptions,
): Promise<T> {
  const target = resolve(filePath)
  const lockPath = `${target}.lock`
  const info = await acquireDiskLock(lockPath, opts)
  try {
    return await withFileLock(target, fn)
  } finally {
    await releaseDiskLock(info)
  }
}

// ── 6. 通用二进制/文本原子替换 ────────────────────────────────────────────

/**
 * 通用原子替换：把 Buffer 写入目标，供后续非 JSON 文件（图/索引等）使用。
 * 协议与 atomicWriteJson 完全一致（临时文件 + fsync 句柄 + rename 覆盖 + 目录 fsync +
 * 失败清理），只是内容为任意 Buffer，不做 JSON 序列化。
 *
 * @param filePath 目标文件绝对路径。
 * @param data 新文件内容的 Buffer。
 * @param opts 可注入临时目录。
 */
export async function atomicReplaceFile(
  filePath: string,
  data: Buffer,
  opts?: AtomicReplaceOptions,
): Promise<void> {
  const target = resolve(filePath)
  const resolvedTmpDir = resolveTmpDir(opts)
  // 显式临时目录：确保其存在，且它与 target 必须同卷（rename 不能跨卷，否则 EEXDEV）。
  // 未注入临时目录时默认与 target 同目录（同目录天然同卷）。
  if (resolvedTmpDir !== undefined) {
    await mkdir(resolvedTmpDir, { recursive: true })
  }
  // 临时文件名带 target base，便于人类排查；整体落在 tmpDir（或同目录）内。
  const tmp = join(resolvedTmpDir ?? dirname(target), `${TEMP_PREFIX}-${process.pid}-${randomBytes(6).toString('hex')}`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, target)
    await fsyncDirectory(dirname(target))
  } catch (error) {
    await rm(tmp, { force: true }) // 失败路径必清理，绝不残留垃圾。
    throw error
  }
}

// ── 崩溃恢复：清理残留临时文件 / 锁文件 ───────────────────────────────────

/**
 * 清理目录下残留的临时文件与陈旧锁文件（崩溃恢复入口）。
 * 目标：进程崩溃可能留下 `.tmp-<pid>-<rand>` 残留或 `.lock` 锁文件。
 * 规则（保守安全）：
 *   - `.tmp` 前缀的残留：直接删除（临时文件无后续用途；若某进程仍活着且正在用，
 *     其文件名随机，当前目录并发清理到它属于极小概率，且清理是幂等的）。
 *   - 锁文件：仅回收「持有 pid 已死」的陈旧锁（复用 tryReapStaleLock 的安全逻辑）；
 *     活泼锁（pid 存活）绝不删除，避免干扰其他进程正在进行的临界区。
 * 每次写路径（atomicWriteJson → 本函数）都调用，保证「下次写自动回收」；也可显式调用。
 *
 * @param dir 要扫描清理的目录。
 * @param opts 陈旧锁阈值与时钟注入。
 * @returns 被清理的文件路径数组。
 */
export async function cleanupStaleTemp(dir: string, opts?: DiskLockOptions): Promise<string[]> {
  const target = resolve(dir)
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE_LOCK_MS
  const now = opts?.now ?? Date.now
  const cleaned: string[] = []
  const entries = await readdir(target).catch((error: unknown) => {
    if (isAbsent(error)) return []
    throw error
  })
  for (const entry of entries) {
    const full = join(target, entry)
    // 模式 1：残留临时文件——历史上所有版本都以 `.tmp` 开头（TEMP_PREFIX 前缀即唯一标识）。
    if (entry.startsWith(TEMP_PREFIX)) {
      await rm(full, { force: true })
      cleaned.push(full)
      continue
    }
    // 模式 2：残留锁文件——后缀 .lock，仅当陈旧（pid 已死且 mtime 超阈值）才回收。
    if (entry.endsWith('.lock')) {
      // 注意：目标目录可能不存在（锁文件在目标目录内，此处直接用 TryReap 的 stat 逻辑）。
      if (await tryReapStaleLock(full, staleAfterMs, now)) cleaned.push(full)
    }
  }
  return cleaned
}
