import { DatabaseSync } from 'node:sqlite';
/** 库文件路径：固定 `<root>/assets.db`（root = 插件 dataDir）。 */
export declare function assetDbPath(root: string): string;
/** 打开（必要时创建）资产库：建父目录、设 PRAGMA、幂等建表（含形状迁移与 Prompt 播种）。 */
export declare function openAssetDatabase(root: string, now?: () => number): DatabaseSync;
/** 行值：node:sqlite 返回 null 原型对象，凡向外传递前都必须转成普通对象。 */
export type DbRow = Record<string, unknown>;
/** 把 null 原型行对象转为普通对象（调用方不得持有驱动内部结构）。 */
export declare function plainRow(row: Record<string, unknown>): DbRow;
/** 查询多行（返回普通对象数组）。 */
export declare function queryRows(db: DatabaseSync, sql: string, params?: unknown[]): DbRow[];
/** 查询单行（无匹配返回 null）。 */
export declare function queryRow(db: DatabaseSync, sql: string, params?: unknown[]): DbRow | null;
/** 执行写语句（INSERT/UPDATE/DELETE）。 */
export declare function runSql(db: DatabaseSync, sql: string, params?: unknown[]): void;
/**
 * SQL `IN` 的占位符串（个数与入参列表严格相等）。
 * 为什么由这个函数生成而不是各读路径手写：占位符个数与参数个数不一致时 SQLite 会把它当成
 * 语法错误或漏绑，而这类错误只在运行时出现；集中在同一处便于逐处核对。
 */
export declare function sqlPlaceholders(values: readonly unknown[]): string;
/** 事务上下文：端口函数只依赖本接口，不直接触碰驱动。 */
export interface AssetTxContext {
    exec(sql: string): void;
    all(sql: string, params?: unknown[]): DbRow[];
    get(sql: string, params?: unknown[]): DbRow | null;
    run(sql: string, params?: unknown[]): void;
}
/** AssetStore 持有的库句柄：连接、串行队列与事务工厂。 */
export declare class AssetDb {
    private readonly root;
    private readonly now;
    private db;
    private readonly queue;
    constructor(root: string, now?: () => number);
    /** 打开连接并建表；重复调用无副作用（幂等）。 */
    open(): Promise<void>;
    /** 关闭连接（幂等；关闭后再操作会重新报「未初始化」）。 */
    close(): void;
    /** 取连接；未 init 时给出可行动错误而非静默空结果。 */
    private require;
    /**
     * 在**一笔事务**内执行 fn 并返回其结果。
     * 为什么用 BEGIN IMMEDIATE：写路径的第一步就是读，IMMEDIATE 立刻取写锁，
     * 避免「读时未锁、写时才发现冲突」的升级失败；进程内并发再由串行队列挡一层。
     */
    withTx<T>(fn: (ctx: AssetTxContext) => Promise<T> | T): Promise<T>;
}
