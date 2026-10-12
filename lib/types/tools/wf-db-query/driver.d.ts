import type { DatabaseNode } from '../../shared/graph-model.js';
import type { DatabaseDriver, QueryOptions, QueryResult, ServerConnection, TableInfo } from './types.js';
/** 表清单条数上限：本地 SQLite 与服务器 MySQL/PostgreSQL 共用同一本体（大库表名列表不灌满上下文）。 */
export declare const SCHEMA_TABLE_LIMIT = 200;
/**
 * 表清单查询语句（三通道共用同一上限本体；语句与上限单点维护）。
 * 多取一行用于精确判定是否被上限截断——结果集返回前仍截到 SCHEMA_TABLE_LIMIT。
 */
export declare function schemaQuery(kind: 'sqlite' | 'mysql' | 'postgresql'): string;
/** 本地 SQLite 驱动：node:sqlite 只读模式（物理防写）。 */
export declare class SqliteDriver implements DatabaseDriver {
    private readonly filePath;
    private db;
    constructor(filePath: string);
    private open;
    testConnection(): Promise<void>;
    /**
     * 只读查询。传 maxRows 时**逐行读取**（`stmt.iterate()`）并在读满上限后立即停止：
     * 多拉一行只为判定截断，`LIMIT 999999999` 这类形式约束因此不再把整表物化进内存。
     */
    query(sql: string, options?: QueryOptions): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
    /** 表清单页：+1 行探测判定截断，返回前截到上限（对外不超过上限）。 */
    schemaPage(): Promise<{
        tables: TableInfo[];
        truncated: boolean;
    }>;
    close(): void;
}
/**
 * 服务器驱动：惰性加载 mysql2/pg（可选依赖）。
 * 驱动未安装时给明确错误（含安装提示）；连接使用完即关（不保留长连接）。
 */
export declare class ServerDriver implements DatabaseDriver {
    private readonly conn;
    constructor(conn: ServerConnection);
    private requireHost;
    private queryMysql;
    private queryPostgres;
    testConnection(): Promise<void>;
    query(sql: string, options?: QueryOptions): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
    /** 表清单页：+1 行探测判定截断，返回前截到上限（对外不超过上限）。 */
    schemaPage(): Promise<{
        tables: TableInfo[];
        truncated: boolean;
    }>;
    close(): void;
}
/** 按数据库节点创建驱动（本地/服务器；配置缺失给明确错误）。 */
export declare function createDatabaseDriver(node: DatabaseNode): DatabaseDriver;
/** 连接测试（GUI dbTest 端点与运行期共用；返回可展示消息）。 */
export declare function testDatabaseConnection(node: DatabaseNode): Promise<{
    ok: boolean;
    message: string;
}>;
