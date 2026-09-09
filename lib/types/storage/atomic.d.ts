/** 磁盘锁获取超时/耗尽重试后抛出的明确错误。 */
export declare class DiskLockError extends Error {
    /** 锁文件路径（便于诊断）。 */
    readonly lockPath: string;
    constructor(message: string, lockPath: string);
}
/** readJson 遇到损坏 JSON（UTF-8 可读但无法解析）时抛出的带路径错误。 */
export declare class CorruptJsonError extends Error {
    /** 目标文件路径。 */
    readonly filePath: string;
    constructor(filePath: string, cause: unknown);
}
/** 原子写 JSON 的选项（全部可注入，便于测试与覆盖）。 */
export interface AtomicWriteJsonOptions {
    /** 显式临时目录（默认与目标同目录）。 */
    tmpDir?: string;
    /** 换行符（默认 '\n'）。 */
    eol?: string;
    /** 缩进（JSON.stringify 第三参，默认 2）。 */
    spaced?: number;
}
/** 磁盘锁获取选项。 */
export interface DiskLockOptions {
    /** 获取成功/超时上限（毫秒）。超时抛 DiskLockError。 */
    timeoutMs?: number;
    /** 陈旧锁回收阈值（毫秒）：锁 mtime 超此且 pid 已死才回收。 */
    staleAfterMs?: number;
    /** 轮询间隔（毫秒）。 */
    pollIntervalMs?: number;
    /** 注入自定义轮询/计时器（便于测试用假时钟加速）。 */
    now?: () => number;
}
/** 临时目录相关选项（atomicReplaceFile）。 */
export interface TmpOptions {
    /** 显式临时目录。 */
    tmpDir?: string;
}
/** 原子替换通用选项。 */
export interface AtomicReplaceOptions extends TmpOptions {
}
/** releaseDiskLock 返回的锁信息。 */
export interface DiskLockInfo {
    /** 锁文件路径。 */
    lockPath: string;
    /** 写入锁文件的元数据原始字符串（release 时校验内容匹配）。 */
    payload: string;
    /** 当前进程 pid。 */
    pid: number;
    /** 创建时间戳（epoch 毫秒）。 */
    createdAt: number;
}
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
export declare function atomicWriteJson(filePath: string, data: unknown, opts?: AtomicWriteJsonOptions): Promise<void>;
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
export declare function readJson<T>(filePath: string, fallback: T): Promise<T>;
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
export declare function withFileLock<T>(path: string, fn: () => Promise<T> | T): Promise<T>;
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
export declare function acquireDiskLock(lockPath: string, opts?: DiskLockOptions): Promise<DiskLockInfo>;
/**
 * 释放磁盘锁：仅删除「自己创建」的锁（校验内容匹配）。
 * 为什么必须校验内容而非无条件删除：若锁已被回收又被他方重建，无条件删除会误删他人锁。
 * 因此先读当前锁内容，与持有时的 payload 逐字比对，一致才 rm；不一致 → 说明锁已易主，
 * 视为「已释放或非本进程持有」，静默返回（不强删，保守安全）。
 *
 * @param info acquireDiskLock 返回的锁信息。
 */
export declare function releaseDiskLock(info: DiskLockInfo): Promise<void>;
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
export declare function withJsonLock<T>(filePath: string, fn: () => Promise<T> | T, opts?: DiskLockOptions): Promise<T>;
/**
 * 通用原子替换：把 Buffer 写入目标，供后续非 JSON 文件（图/索引等）使用。
 * 协议与 atomicWriteJson 完全一致（临时文件 + fsync 句柄 + rename 覆盖 + 目录 fsync +
 * 失败清理），只是内容为任意 Buffer，不做 JSON 序列化。
 *
 * @param filePath 目标文件绝对路径。
 * @param data 新文件内容的 Buffer。
 * @param opts 可注入临时目录。
 */
export declare function atomicReplaceFile(filePath: string, data: Buffer, opts?: AtomicReplaceOptions): Promise<void>;
export declare function cleanupStaleTemp(dir: string, opts?: DiskLockOptions): Promise<string[]>;
