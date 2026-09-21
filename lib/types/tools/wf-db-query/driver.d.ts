import type { DatabaseNode } from '../../shared/graph-model.js';
import type { DatabaseDriver, QueryResult, ServerConnection, TableInfo } from './types.js';
/** 本地 SQLite 驱动：node:sqlite 只读模式（物理防写）。 */
export declare class SqliteDriver implements DatabaseDriver {
    private readonly filePath;
    private db;
    constructor(filePath: string);
    private open;
    testConnection(): Promise<void>;
    query(sql: string): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
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
    query(sql: string): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
    close(): void;
}
/** 按数据库节点创建驱动（本地/服务器；配置缺失给明确错误）。 */
export declare function createDatabaseDriver(node: DatabaseNode): DatabaseDriver;
/** 连接测试（GUI dbTest 端点与运行期共用；返回可展示消息）。 */
export declare function testDatabaseConnection(node: DatabaseNode): Promise<{
    ok: boolean;
    message: string;
}>;
