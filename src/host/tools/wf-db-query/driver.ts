// src/host/tools/wf-db-query/driver.ts
//
// wf_db_query 的数据库驱动：本地 SQLite（node:sqlite 只读模式，物理防写）与
// 服务器 MySQL/PostgreSQL。
//
// 驱动加载策略：mysql2/pg 为可选依赖，运行时惰性 import——未安装时给出明确错误
// 而非崩溃；主分发路径（本地 SQLite）零第三方驱动依赖。
// 连接按次创建即用即关（不保留长连接）。

import { DatabaseSync } from 'node:sqlite'
import { WfError } from '../../orchestrator/index.js'
import type { DatabaseNode } from '../../shared/graph-model.js'
import type { DatabaseDriver, QueryOptions, QueryResult, ServerConnection, TableInfo } from './types.js'

/** 表清单条数上限：本地 SQLite 与服务器 MySQL/PostgreSQL 共用同一本体（大库表名列表不灌满上下文）。 */
export const SCHEMA_TABLE_LIMIT = 200

/** 执行层行数上限：非有限或 <1 视为未设上限（`null` = 不限制）。 */
function rowCapOf(options?: QueryOptions): number | null {
  const maxRows = options?.maxRows
  return typeof maxRows === 'number' && Number.isFinite(maxRows) && maxRows >= 1 ? Math.floor(maxRows) : null
}

/** 行对象 → 字符串单元格（null/undefined → 空串；与全量读取路径同一口径）。 */
function rowValues(row: Record<string, unknown>, columns: string[]): string[] {
  return columns.map((column) => (row[column] == null ? '' : String(row[column])))
}

/** 结果集按执行层上限收口（供在客户端库边界已物化的服务器驱动使用）。 */
function capRows(result: QueryResult, maxRows: number | null): QueryResult {
  if (maxRows === null) return result
  if (result.rows.length <= maxRows) return { columns: result.columns, rows: result.rows, truncated: false }
  return { columns: result.columns, rows: result.rows.slice(0, maxRows), truncated: true }
}

/**
 * 表清单查询语句（三通道共用同一上限本体；语句与上限单点维护）。
 * 多取一行用于精确判定是否被上限截断——结果集返回前仍截到 SCHEMA_TABLE_LIMIT。
 */
export function schemaQuery(kind: 'sqlite' | 'mysql' | 'postgresql'): string {
  const probe = SCHEMA_TABLE_LIMIT + 1
  if (kind === 'mysql') return `SHOW TABLES LIMIT ${probe}`
  if (kind === 'postgresql') {
    return `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT ${probe}`
  }
  return `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT ${probe}`
}

/** 本地 SQLite 驱动：node:sqlite 只读模式（物理防写）。 */
export class SqliteDriver implements DatabaseDriver {
  private db: DatabaseSync | null = null

  constructor(private readonly filePath: string) {}

  private open(): DatabaseSync {
    if (!this.db) {
      this.db = new DatabaseSync(this.filePath, { readOnly: true })
    }
    return this.db
  }

  async testConnection(): Promise<void> {
    this.open().prepare('SELECT 1').get()
  }

  /**
   * 只读查询。传 maxRows 时**逐行读取**（`stmt.iterate()`）并在读满上限后立即停止：
   * 多拉一行只为判定截断，`LIMIT 999999999` 这类形式约束因此不再把整表物化进内存。
   */
  async query(sql: string, options?: QueryOptions): Promise<QueryResult> {
    const statement = this.open().prepare(sql)
    const maxRows = rowCapOf(options)
    if (maxRows === null) {
      const rows = statement.all() as Array<Record<string, unknown>>
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { columns, rows: rows.map((row) => rowValues(row, columns)) }
    }
    const rows: Array<Record<string, unknown>> = []
    let columns: string[] = []
    const iterator = statement.iterate()
    for (let step = iterator.next(); !step.done; step = iterator.next()) {
      const row = step.value
      if (rows.length === 0) columns = Object.keys(row)
      // 多拉到的这一行只用于判定截断，不进入结果（正好满上限时不会进入本分支）
      if (rows.length === maxRows) {
        return { columns, rows: rows.map((item) => rowValues(item, columns)), truncated: true }
      }
      rows.push(row)
    }
    return { columns, rows: rows.map((row) => rowValues(row, columns)), truncated: false }
  }

  async schema(): Promise<TableInfo[]> {
    return (await this.schemaPage()).tables
  }

  /** 表清单页：+1 行探测判定截断，返回前截到上限（对外不超过上限）。 */
  async schemaPage(): Promise<{ tables: TableInfo[]; truncated: boolean }> {
    const rows = this.open().prepare(schemaQuery('sqlite')).all() as Array<Record<string, unknown>>
    const tables = rows.slice(0, SCHEMA_TABLE_LIMIT).map((row) => ({ name: String(row.name ?? '') }))
    return { tables, truncated: rows.length > SCHEMA_TABLE_LIMIT }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // 关闭尽力而为
    }
    this.db = null
  }
}

/**
 * 服务器驱动：惰性加载 mysql2/pg（可选依赖）。
 * 驱动未安装时给明确错误（含安装提示）；连接使用完即关（不保留长连接）。
 */
export class ServerDriver implements DatabaseDriver {
  constructor(private readonly conn: ServerConnection) {}

  private requireHost(): string {
    const host = String(this.conn.host ?? '').trim()
    if (!host) throw new WfError('WF_DB_CONFIG: this database node has no server host configured', 'WF_DB_CONFIG')
    return host
  }

  private async queryMysql(sql: string): Promise<QueryResult> {
    let mysql: { createConnection(input: unknown): Promise<{ query(sql: string): Promise<[unknown[], unknown[]]>; end(): Promise<void> }> }
    try {
      mysql = (await import('mysql2/promise')) as unknown as typeof mysql
    } catch {
      throw new WfError('WF_DB_DRIVER_MISSING: querying a MySQL server requires the mysql2 driver; install mysql2 in the runtime environment', 'WF_DB_DRIVER_MISSING')
    }
    const connection = await mysql.createConnection({
      host: this.requireHost(),
      port: Number(this.conn.port) || 3306,
      user: String(this.conn.user ?? ''),
      password: String(this.conn.password ?? ''),
      database: String(this.conn.db ?? ''),
    })
    try {
      const [rows, fields] = await connection.query(sql)
      const columns = (fields as Array<{ name?: string }>).map((field) => String(field.name ?? ''))
      return {
        columns,
        rows: (rows as Array<Record<string, unknown>>).map((row) =>
          columns.map((column) => (row[column] == null ? '' : String(row[column]))),
        ),
      }
    } finally {
      await connection.end().catch(() => {})
    }
  }

  private async queryPostgres(sql: string): Promise<QueryResult> {
    let pg: { Client: new (input: unknown) => { connect(): Promise<void>; query(sql: string): Promise<{ fields: Array<{ name?: string }>; rows: Array<Record<string, unknown>> }>; end(): Promise<void> } }
    try {
      pg = (await import('pg')) as unknown as typeof pg
    } catch {
      throw new WfError('WF_DB_DRIVER_MISSING: querying a PostgreSQL server requires the pg driver; install pg in the runtime environment', 'WF_DB_DRIVER_MISSING')
    }
    const client = new pg.Client({
      host: this.requireHost(),
      port: Number(this.conn.port) || 5432,
      user: String(this.conn.user ?? ''),
      password: String(this.conn.password ?? ''),
      database: String(this.conn.db ?? ''),
    })
    await client.connect()
    try {
      const result = await client.query(sql)
      const columns = result.fields.map((field) => String(field.name ?? ''))
      return {
        columns,
        rows: result.rows.map((row) => columns.map((column) => (row[column] == null ? '' : String(row[column])))),
      }
    } finally {
      await client.end().catch(() => {})
    }
  }

  async testConnection(): Promise<void> {
    if (this.conn.dbKind === 'mysql') {
      await this.queryMysql('SELECT 1 LIMIT 1')
    } else {
      await this.queryPostgres('SELECT 1 LIMIT 1')
    }
  }

  async query(sql: string, options?: QueryOptions): Promise<QueryResult> {
    const result = this.conn.dbKind === 'mysql' ? await this.queryMysql(sql) : await this.queryPostgres(sql)
    // 服务器驱动在客户端库边界一次性物化结果集（不引入游标依赖）：此处只做上限收口与截断上报。
    return capRows(result, rowCapOf(options))
  }

  async schema(): Promise<TableInfo[]> {
    return (await this.schemaPage()).tables
  }

  /** 表清单页：+1 行探测判定截断，返回前截到上限（对外不超过上限）。 */
  async schemaPage(): Promise<{ tables: TableInfo[]; truncated: boolean }> {
    const result = this.conn.dbKind === 'mysql'
      ? await this.queryMysql(schemaQuery('mysql'))
      : await this.queryPostgres(schemaQuery('postgresql'))
    const tables = result.rows.slice(0, SCHEMA_TABLE_LIMIT).map((row) => ({ name: row[0] ?? '' }))
    return { tables, truncated: result.rows.length > SCHEMA_TABLE_LIMIT }
  }

  close(): void {
    // 连接按次创建即用即关，无长连接可释放
  }
}

/** 按数据库节点创建驱动（本地/服务器；配置缺失给明确错误）。 */
export function createDatabaseDriver(node: DatabaseNode): DatabaseDriver {
  if (node.data.dbType === 'local') {
    if (!node.data.localPath) throw new WfError('WF_DB_CONFIG: this database node has no local file path configured', 'WF_DB_CONFIG')
    return new SqliteDriver(node.data.localPath)
  }
  if (!node.data.conn) throw new WfError('WF_DB_CONFIG: this database node has no server connection configured', 'WF_DB_CONFIG')
  const conn = node.data.conn
  return new ServerDriver({
    dbKind: node.data.dbKind === 'postgresql' ? 'postgresql' : 'mysql',
    host: conn.host,
    port: Number(conn.port) || 0,
    user: conn.user,
    password: conn.password,
    db: conn.db,
  })
}

/** 连接测试（GUI dbTest 端点与运行期共用；返回可展示消息）。 */
export async function testDatabaseConnection(node: DatabaseNode): Promise<{ ok: boolean; message: string }> {
  try {
    const driver = createDatabaseDriver(node)
    try {
      await driver.testConnection()
    } finally {
      driver.close()
    }
    return { ok: true, message: '连接成功' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `连接失败：${message}` }
  }
}
