// src/host/tools/wf-db-query/driver.ts
//
// wf_db_query 的数据库驱动：本地 SQLite（node:sqlite 只读模式，物理防写）与
// 服务器 MySQL/PostgreSQL。
//
// 驱动加载策略：mysql2/pg 为可选依赖，运行时惰性 import——未安装时给出明确错误
// 而非崩溃；主分发路径（本地 SQLite）零第三方驱动依赖。
// 连接按次创建即用即关（不保留长连接）。
import { DatabaseSync } from 'node:sqlite';
import { WfError } from '../../orchestrator/index.js';
/** 本地 SQLite 驱动：node:sqlite 只读模式（物理防写）。 */
export class SqliteDriver {
    filePath;
    db = null;
    constructor(filePath) {
        this.filePath = filePath;
    }
    open() {
        if (!this.db) {
            this.db = new DatabaseSync(this.filePath, { readOnly: true });
        }
        return this.db;
    }
    async testConnection() {
        this.open().prepare('SELECT 1').get();
    }
    async query(sql) {
        const rows = this.open().prepare(sql).all();
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
            columns,
            rows: rows.map((row) => columns.map((column) => (row[column] == null ? '' : String(row[column])))),
        };
    }
    async schema() {
        const rows = this.open()
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .all();
        return rows.map((row) => ({ name: String(row.name ?? '') }));
    }
    close() {
        try {
            this.db?.close();
        }
        catch {
            // 关闭尽力而为
        }
        this.db = null;
    }
}
/**
 * 服务器驱动：惰性加载 mysql2/pg（可选依赖）。
 * 驱动未安装时给明确错误（含安装提示）；连接使用完即关（不保留长连接）。
 */
export class ServerDriver {
    conn;
    constructor(conn) {
        this.conn = conn;
    }
    requireHost() {
        const host = String(this.conn.host ?? '').trim();
        if (!host)
            throw new WfError('数据库节点未配置服务器地址', 'WF_DB_CONFIG');
        return host;
    }
    async queryMysql(sql) {
        let mysql;
        try {
            mysql = (await import('mysql2/promise'));
        }
        catch {
            throw new WfError('服务器数据库（MySQL）查询需要驱动：请在运行环境安装 mysql2', 'WF_DB_DRIVER_MISSING');
        }
        const connection = await mysql.createConnection({
            host: this.requireHost(),
            port: Number(this.conn.port) || 3306,
            user: String(this.conn.user ?? ''),
            password: String(this.conn.password ?? ''),
            database: String(this.conn.db ?? ''),
        });
        try {
            const [rows, fields] = await connection.query(sql);
            const columns = fields.map((field) => String(field.name ?? ''));
            return {
                columns,
                rows: rows.map((row) => columns.map((column) => (row[column] == null ? '' : String(row[column])))),
            };
        }
        finally {
            await connection.end().catch(() => { });
        }
    }
    async queryPostgres(sql) {
        let pg;
        try {
            pg = (await import('pg'));
        }
        catch {
            throw new WfError('服务器数据库（PostgreSQL）查询需要驱动：请在运行环境安装 pg', 'WF_DB_DRIVER_MISSING');
        }
        const client = new pg.Client({
            host: this.requireHost(),
            port: Number(this.conn.port) || 5432,
            user: String(this.conn.user ?? ''),
            password: String(this.conn.password ?? ''),
            database: String(this.conn.db ?? ''),
        });
        await client.connect();
        try {
            const result = await client.query(sql);
            const columns = result.fields.map((field) => String(field.name ?? ''));
            return {
                columns,
                rows: result.rows.map((row) => columns.map((column) => (row[column] == null ? '' : String(row[column])))),
            };
        }
        finally {
            await client.end().catch(() => { });
        }
    }
    async testConnection() {
        if (this.conn.dbKind === 'mysql') {
            await this.queryMysql('SELECT 1 LIMIT 1');
        }
        else {
            await this.queryPostgres('SELECT 1 LIMIT 1');
        }
    }
    async query(sql) {
        if (this.conn.dbKind === 'mysql')
            return this.queryMysql(sql);
        return this.queryPostgres(sql);
    }
    async schema() {
        if (this.conn.dbKind === 'mysql') {
            const result = await this.queryMysql('SHOW TABLES LIMIT 200');
            return result.rows.map((row) => ({ name: row[0] ?? '' }));
        }
        const result = await this.queryPostgres("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 200");
        return result.rows.map((row) => ({ name: row[0] ?? '' }));
    }
    close() {
        // 连接按次创建即用即关，无长连接可释放
    }
}
/** 按数据库节点创建驱动（本地/服务器；配置缺失给明确错误）。 */
export function createDatabaseDriver(node) {
    if (node.data.dbType === 'local') {
        if (!node.data.localPath)
            throw new WfError('数据库节点未配置本地文件路径', 'WF_DB_CONFIG');
        return new SqliteDriver(node.data.localPath);
    }
    if (!node.data.conn)
        throw new WfError('数据库节点未配置服务器连接信息', 'WF_DB_CONFIG');
    const conn = node.data.conn;
    return new ServerDriver({
        dbKind: node.data.dbKind === 'postgresql' ? 'postgresql' : 'mysql',
        host: conn.host,
        port: Number(conn.port) || 0,
        user: conn.user,
        password: conn.password,
        db: conn.db,
    });
}
/** 连接测试（GUI dbTest 端点与运行期共用；返回可展示消息）。 */
export async function testDatabaseConnection(node) {
    try {
        const driver = createDatabaseDriver(node);
        try {
            await driver.testConnection();
        }
        finally {
            driver.close();
        }
        return { ok: true, message: '连接成功' };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `连接失败：${message}` };
    }
}
//# sourceMappingURL=driver.js.map