// src/host/assets/db.ts
//
// 资产库连接与事务：打开/关闭、PRAGMA、withTx 事务助手。
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
/** 打开（必要时创建）资产库：建父目录、设 PRAGMA、幂等建表（含形状迁移与 Prompt 播种）。 */
export function openAssetDatabase(root, now = Date.now) {
    const file = assetDbPath(root);
    mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    try {
        // 外键是 Active→History 引用完整性的唯一保障，每个连接都必须显式开启
        db.exec('PRAGMA foreign_keys = ON');
        applyJournalMode(db);
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
/** 把 null 原型行对象转为普通对象（调用方不得持有驱动内部结构）。 */
export function plainRow(row) {
    return { ...row };
}
/** 查询多行（返回普通对象数组）。 */
export function queryRows(db, sql, params = []) {
    return db
        .prepare(sql)
        .all(...params)
        .map((row) => plainRow(row));
}
/** 查询单行（无匹配返回 null）。 */
export function queryRow(db, sql, params = []) {
    const row = db.prepare(sql).get(...params);
    return row === undefined ? null : plainRow(row);
}
/** 执行写语句（INSERT/UPDATE/DELETE）。 */
export function runSql(db, sql, params = []) {
    db.prepare(sql).run(...params);
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
    db = null;
    queue = new SerialQueue();
    constructor(root, now = Date.now) {
        this.root = root;
        this.now = now;
    }
    /** 打开连接并建表；重复调用无副作用（幂等）。 */
    open() {
        if (this.db)
            return Promise.resolve();
        const db = openAssetDatabase(this.root, this.now);
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