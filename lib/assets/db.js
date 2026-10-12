// src/host/assets/db.ts
//
// 资产库连接与事务：打开/关闭、PRAGMA、withTx 事务助手，以及连接级的语句缓存。
//
// 为什么读改写必须共用 withTx：资产写路径存在「先查历史/Active、再决定新增版本还是
// 仅移动指针」的读改写序列，裸读裸写会在两个进程之间留下丢更新窗口；withTx 内的
// 全部语句共享同一事务，失败即回滚，不留半成品。
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ASSET_DB_FILE, initSchema } from './schema.js';
/** 库文件路径：固定 `<root>/assets.db`（root = 插件 dataDir）。 */
export function assetDbPath(root) {
    return join(root, ASSET_DB_FILE);
}
/**
 * 打开（必要时创建）资产库：建父目录、设 PRAGMA、幂等建表（含形状迁移与 Prompt 播种）。
 * `readOnly` 用于只读介质/备份浏览等场景：跳过会写盘的初始化，只做一次完整性校验。
 */
export function openAssetDatabase(root, now = Date.now, options = {}) {
    const readOnly = options.readOnly === true;
    const file = assetDbPath(root);
    if (!readOnly)
        mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
    try {
        // 外键是 Active→History 引用完整性的唯一保障，每个连接都必须显式开启
        db.exec('PRAGMA foreign_keys = ON');
        applyJournalMode(db);
        if (!readOnly)
            initSchema(db, now);
    }
    catch (error) {
        // 初始化失败（含形状迁移失败）不留下半开的连接：调用方要么拿到可用库，要么拿到错误
        db.close();
        throw error;
    }
    return db;
}
/**
 * WAL 让「读不阻塞写」且崩溃后可恢复。
 * 降级说明：网络盘/只读介质等场景 SQLite 无法切换日志模式，此时保持默认
 * delete 模式继续可用——日志模式是性能与并发优化，不是正确性前提，故不抛错。
 */
function applyJournalMode(db) {
    try {
        db.exec('PRAGMA journal_mode = WAL');
    }
    catch {
        // 保持默认日志模式，写路径与事务语义不变
    }
}
/**
 * 连接 → SQL 原文 → 已编译语句。三个通用入口（queryRows / queryRow / runSql）共用同一份缓存，
 * 因此列表读、逐项明细与热点写语句都只编译一次。
 *
 * 为什么按连接分桶：语句与连接同生命周期，跨连接复用无效（驱动会拒绝）；WeakMap 让连接
 * 关闭后整桶随之可回收，无需人工失效。
 * 为什么键是 SQL 原文：参数一律经绑定传值，同一原文的语句对任意入参都可用；语句由 SQLite
 * 在执行前复位，可安全重复执行。
 * 为什么有长度上限：`IN (?,?,…)` 这类文本随入参个数变化，缓存因此可能有多个条目；缓存是纯
 * 加速设施，不允许变成无界内存增长点，超限即整体丢弃（下次执行重新编译，不影响正确性）。
 */
const statementCache = new WeakMap();
const STATEMENT_CACHE_LIMIT = 256;
/** 取（必要时编译并缓存）语句。 */
function preparedStatement(db, sql) {
    let bySql = statementCache.get(db);
    if (!bySql) {
        bySql = new Map();
        statementCache.set(db, bySql);
    }
    const cached = bySql.get(sql);
    if (cached)
        return cached;
    if (bySql.size >= STATEMENT_CACHE_LIMIT)
        bySql.clear();
    const statement = db.prepare(sql);
    bySql.set(sql, statement);
    return statement;
}
/** 把 null 原型行对象转为普通对象（调用方不得持有驱动内部结构）。 */
export function plainRow(row) {
    return { ...row };
}
/** 查询多行（返回普通对象数组）。 */
export function queryRows(db, sql, params = []) {
    return preparedStatement(db, sql)
        .all(...params)
        .map((row) => plainRow(row));
}
/** 查询单行（无匹配返回 null）。 */
export function queryRow(db, sql, params = []) {
    const row = preparedStatement(db, sql).get(...params);
    return row === undefined ? null : plainRow(row);
}
/** 执行写语句（INSERT/UPDATE/DELETE）。 */
export function runSql(db, sql, params = []) {
    preparedStatement(db, sql).run(...params);
}
/**
 * SQL `IN` 的占位符串（个数与入参列表严格相等）。
 * 为什么由这个函数生成而不是各读路径手写：占位符个数与参数个数不一致时 SQLite 会把它当成
 * 语法错误或漏绑，而这类错误只在运行时出现；集中在同一处便于逐处核对。
 */
export function sqlPlaceholders(values) {
    return values.map(() => '?').join(', ');
}
/**
 * 进程内串行队列：DatabaseSync 全程同步，但 `withTx` 的回调签名是 async
 * （调用方可在事务内 await）。若不加队列，两个并发写事务会交错拿到同一事务，
 * 一方回滚会连带回滚另一方已完成的写入。队列保证「一笔事务跑完再进下一笔」。
 */
class SerialQueue {
    tail = Promise.resolve();
    run(task) {
        const result = this.tail.then(task, task);
        this.tail = result.catch(() => undefined);
        return result;
    }
}
/** AssetStore 持有的库句柄：连接、串行队列与事务工厂。 */
export class AssetDb {
    root;
    now;
    readOnly;
    db = null;
    queue = new SerialQueue();
    constructor(root, now = Date.now, readOnly = false) {
        this.root = root;
        this.now = now;
        this.readOnly = readOnly;
    }
    /** 打开连接并建表；重复调用无副作用（幂等）。 */
    open() {
        if (this.db)
            return Promise.resolve();
        const db = openAssetDatabase(this.root, this.now, { readOnly: this.readOnly });
        const verdict = integrityVerdict(db);
        if (verdict !== 'ok') {
            // 损坏库不静默当空库用：交给调用方决策（重建/备份），不带着坏数据继续写
            db.close();
            throw new Error(`资产库 ${assetDbPath(this.root)} 完整性校验失败：${verdict}`);
        }
        this.db = db;
        return Promise.resolve();
    }
    /** 关闭连接（幂等；关闭后再操作会重新报「未初始化」）。 */
    close() {
        if (!this.db)
            return;
        const db = this.db;
        this.db = null;
        try {
            db.close();
        }
        catch {
            // 关闭尽力而为：连接已不可用时无需二次抛错
        }
    }
    /** 取连接；未 init 时给出可行动错误而非静默空结果。 */
    require() {
        if (!this.db)
            throw new Error('资产库尚未初始化：请先 await store.init()');
        return this.db;
    }
    /**
     * 在**一笔事务**内执行 fn 并返回其结果。
     * 为什么用 BEGIN IMMEDIATE：写路径的第一步就是读，IMMEDIATE 立刻取写锁，
     * 避免「读时未锁、写时才发现冲突」的升级失败；进程内并发再由串行队列挡一层。
     */
    async withTx(fn) {
        return this.queue.run(async () => {
            const db = this.require();
            const ctx = createContext(db);
            db.exec('BEGIN IMMEDIATE');
            try {
                const result = await fn(ctx);
                db.exec('COMMIT');
                return result;
            }
            catch (error) {
                try {
                    db.exec('ROLLBACK');
                }
                catch {
                    // 事务可能已被 SQLite 因错误自动回滚，此处只保证不覆盖原始错误
                }
                throw error;
            }
        });
    }
    /**
     * 在**一笔只读事务**内执行 fn 并返回其结果（读路径的唯一入口）。
     *
     * 为什么不用 withTx：`BEGIN IMMEDIATE` 会立刻取写锁，把「列资产 / 读经验 / 读统计」这些纯读
     * 操作变成写事务——它们彼此互斥、与写互斥，另一连接（或另一进程）持有写事务时读还会直接
     * 以 `database is locked` 失败。`BEGIN DEFERRED` 在 WAL 下读的是快照，不阻塞写入也不被写入
     * 阻塞（`db.ts` 顶部所宣称的 WAL 价值由此才成立）。
     *
     * 只读事务里**不得写**：没有写锁保护，误写会退化成锁升级并可能失败；这里用
     * `PRAGMA query_only` 把该约定变成运行期事实，而不是只写在注释里。进程内仍经串行队列——
     * 同一连接上的语句不得交错。
     */
    async withRead(fn) {
        return this.queue.run(async () => {
            const db = this.require();
            const ctx = createContext(db);
            db.exec('PRAGMA query_only = ON');
            try {
                db.exec('BEGIN DEFERRED');
                const result = await fn(ctx);
                db.exec('COMMIT');
                return result;
            }
            catch (error) {
                try {
                    db.exec('ROLLBACK');
                }
                catch {
                    // 事务可能已被 SQLite 因错误自动回滚，此处只保证不覆盖原始错误
                }
                throw error;
            }
            finally {
                // 队列保证同一时刻只有一个事务在跑，因此复位不会影响其它读路径
                db.exec('PRAGMA query_only = OFF');
            }
        });
    }
}
/** 完整性校验结论（`ok` 表示可用；其余为 SQLite 给出的损坏描述）。 */
function integrityVerdict(db) {
    const row = db.prepare('PRAGMA integrity_check').get();
    const verdict = row ? String(Object.values(row)[0] ?? '') : '';
    return verdict || 'unknown';
}
function createContext(db) {
    return {
        exec: (sql) => db.exec(sql),
        all: (sql, params) => queryRows(db, sql, params),
        get: (sql, params) => queryRow(db, sql, params),
        run: (sql, params) => runSql(db, sql, params),
    };
}
//# sourceMappingURL=db.js.map