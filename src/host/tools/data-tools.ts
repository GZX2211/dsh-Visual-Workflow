// src/host/tools/data-tools.ts
//
// 数据库访问工具（wf_db_query 单工具三模式）与数据库驱动。
//
// 需求语义（数据库节点）：
//   - 本地 SQLite：向量检索（内置嵌入，不可用降级 BM25 并标注）+ 结构化只读查询；
//   - 服务器 MySQL/PostgreSQL：结构化只读查询 + 表结构（不提供向量检索）；
//   - 数据库内容绝不直接注入上下文，仅经工具查询结果返回。
//
// 安全边界（架构安全章节）：
//   - SQL 只读白名单：仅单条 SELECT、强制 LIMIT、拒绝写/DDL/多语句/文件导出；
//   - 归属校验：调用者必须是运行中工作流的父代理或节点子代理，且该节点经
//     db-in 连线接入目标数据节点（无连线拒绝——与「无连线不注入」可见性一致）；
//   - 本地 SQLite 以只读模式打开（node:sqlite readOnly），物理防写。
//
// 服务器驱动加载策略：mysql2/pg 为可选依赖，运行时惰性 import——未安装时给出
// 明确错误而非崩溃；主分发路径（本地 SQLite + 向量检索）零第三方驱动依赖。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）。

import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DatabaseNode, GraphNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import { dbInEdges, nodeById } from '../graph/model.js'
import type { CallerInfo, OrchestratorRuntime } from '../orchestrator/runtime.js'
import { WfError } from '../orchestrator/runtime.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { EmbeddingEngine } from '../embedding/engine.js'
import { VectorIndex, type IndexRecord, type VectorIndexFile } from '../embedding/indexer.js'
import { WF_DB_QUERY } from '../shared/protocol.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from './define-tool.js'
import { textRender } from './text-render.js'
import { callerOf } from './wf-tools.js'

// ---------------------------------------------------------------------------
// SQL 只读白名单（纯函数）
// ---------------------------------------------------------------------------

/** SQL 校验结果：通过（含规范化后的单条 SQL）或拒绝（错误原因）。 */
export type SqlCheckResult = { ok: true; sql: string } | { ok: false; error: string }

/**
 * 只读 SQL 白名单校验：
 *   - 剥离注释（行注释与块注释）后 trim；空 → 拒绝；
 *   - 多语句拒绝（去除尾部单分号后仍含分号）；
 *   - 首关键字必须 SELECT；
 *   - 写/DDL 关键字黑名单（词边界）拒绝；
 *   - 文件导出（INTO OUTFILE/DUMPFILE）拒绝；
 *   - 必须携带 LIMIT 数字（强制行数上限，防全表拉取）。
 */
export function sanitizeReadOnlySql(raw: string): SqlCheckResult {
  const input = String(raw ?? '').trim()
  if (!input) return { ok: false, error: 'SQL 不能为空' }
  const stripped = input
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
  if (!stripped) return { ok: false, error: 'SQL 不能为空' }
  const single = stripped.replace(/;\s*$/, '')
  if (single.includes(';')) return { ok: false, error: '仅允许单条语句（禁止多语句）' }
  if (!/^select\b/i.test(single)) return { ok: false, error: '仅允许只读 SELECT 查询' }
  // 黑名单前先剥离字符串字面量：`WHERE name = 'update'` 中的字面量词不是语句
  // 关键字（护栏是 fail-closed 正则，不做完整 SQL 解析；字面量剥离消除常见误伤）
  const literalFree = single.replace(/'(?:[^']|'')*'/g, "''")
  const blocked = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|attach|detach|vacuum|pragma|reindex|replace|execute)\b/i
  if (blocked.test(literalFree)) return { ok: false, error: '包含被禁止的写/DDL 关键字' }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(literalFree)) return { ok: false, error: '禁止导出文件' }
  if (!/\blimit\s+\d+/i.test(single)) return { ok: false, error: 'SELECT 必须携带 LIMIT 行数限制' }
  return { ok: true, sql: single }
}

// ---------------------------------------------------------------------------
// 数据库驱动（本地 SQLite / 服务器 MySQL-PostgreSQL）
// ---------------------------------------------------------------------------

/** 查询结果（columns 与 rows 对齐；rows 内值已 String 化，便于模型读取与 schema 表达）。 */
export interface QueryResult {
  columns: string[]
  rows: string[][]
}

/** 表结构条目。 */
export interface TableInfo {
  name: string
}

/** 数据库驱动接口（testConnection/query/schema/close）。 */
export interface DatabaseDriver {
  testConnection(): Promise<void>
  query(sql: string): Promise<QueryResult>
  schema(): Promise<TableInfo[]>
  close(): void
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

  async query(sql: string): Promise<QueryResult> {
    const rows = this.open().prepare(sql).all() as Array<Record<string, unknown>>
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    return {
      columns,
      rows: rows.map((row) => columns.map((column) => (row[column] == null ? '' : String(row[column])))),
    }
  }

  async schema(): Promise<TableInfo[]> {
    const rows = this.open()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({ name: String(row.name ?? '') }))
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

/** 服务器连接信息（mysql/postgresql 共用）。 */
export interface ServerConnection {
  dbKind: 'mysql' | 'postgresql'
  host: string
  port: number
  user: string
  password: string
  db: string
}

/**
 * 服务器驱动：惰性加载 mysql2/pg（可选依赖）。
 * 驱动未安装时给明确错误（含安装提示）；连接使用完即关（不保留长连接）。
 */
export class ServerDriver implements DatabaseDriver {
  constructor(private readonly conn: ServerConnection) {}

  private requireHost(): string {
    const host = String(this.conn.host ?? '').trim()
    if (!host) throw new WfError('数据库节点未配置服务器地址', 'WF_DB_CONFIG')
    return host
  }

  private async queryMysql(sql: string): Promise<QueryResult> {
    let mysql: { createConnection(input: unknown): Promise<{ query(sql: string): Promise<[unknown[], unknown[]]>; end(): Promise<void> }> }
    try {
      mysql = (await import('mysql2/promise')) as unknown as typeof mysql
    } catch {
      throw new WfError('服务器数据库（MySQL）查询需要驱动：请在运行环境安装 mysql2', 'WF_DB_DRIVER_MISSING')
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
      throw new WfError('服务器数据库（PostgreSQL）查询需要驱动：请在运行环境安装 pg', 'WF_DB_DRIVER_MISSING')
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

  async query(sql: string): Promise<QueryResult> {
    if (this.conn.dbKind === 'mysql') return this.queryMysql(sql)
    return this.queryPostgres(sql)
  }

  async schema(): Promise<TableInfo[]> {
    if (this.conn.dbKind === 'mysql') {
      const result = await this.queryMysql('SHOW TABLES LIMIT 200')
      return result.rows.map((row) => ({ name: row[0] ?? '' }))
    }
    const result = await this.queryPostgres(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 200",
    )
    return result.rows.map((row) => ({ name: row[0] ?? '' }))
  }

  close(): void {
    // 连接按次创建即用即关，无长连接可释放
  }
}

/** 按数据库节点创建驱动（本地/服务器；配置缺失给明确错误）。 */
export function createDatabaseDriver(node: DatabaseNode): DatabaseDriver {
  if (node.data.dbType === 'local') {
    if (!node.data.localPath) throw new WfError('数据库节点未配置本地文件路径', 'WF_DB_CONFIG')
    return new SqliteDriver(node.data.localPath)
  }
  if (!node.data.conn) throw new WfError('数据库节点未配置服务器连接信息', 'WF_DB_CONFIG')
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

// ---------------------------------------------------------------------------
// 索引构建（本地向量检索的数据来源；GUI 数据库面板触发）
// ---------------------------------------------------------------------------

/** 本地库索引构建上限（防超大库打爆内存；超限截断并返回截断标记）。 */
export const INDEX_MAX_ROWS = 10000

/**
 * 为本地 SQLite 构建向量索引：全表全行文本化（列值 join）后按行分块。
 * 每行一条源记录（source=表名），行内超长由分块器切窗；原子持久化到
 * <dataDir>/data/vector/<dataId>.json。嵌入不可用时自动落 BM25 索引。
 */
export async function buildIndexForDatabase(
  dataDir: string,
  node: DatabaseNode,
  engine: EmbeddingEngine,
): Promise<{ file: VectorIndexFile; truncated: boolean }> {
  if (node.data.dbType !== 'local' || !node.data.localPath) {
    throw new WfError('仅本地 SQLite 数据库支持向量检索索引', 'WF_DB_MODE')
  }
  const driver = new SqliteDriver(node.data.localPath)
  let truncated = false
  try {
    const tables = await driver.schema()
    const records: IndexRecord[] = []
    for (const table of tables) {
      if (records.length >= INDEX_MAX_ROWS) {
        truncated = true
        break
      }
      const result = await driver.query(`SELECT * FROM "${table.name}" LIMIT ${INDEX_MAX_ROWS - records.length}`)
      const columns = result.columns
      for (const row of result.rows) {
        records.push({
          text: row.map((value, index) => `${columns[index]}: ${value}`).join('\n'),
          source: table.name,
        })
      }
    }
    const index = new VectorIndex(indexPathOf(dataDir, node.id))
    const file = await index.rebuild({
      dataId: node.id,
      records,
      engine,
    })
    return { file, truncated }
  } finally {
    driver.close()
  }
}

/** 索引文件路径（安全文件名：dataId 消毒）。 */
export function indexPathOf(dataDir: string, dataId: string): string {
  const safe = String(dataId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return join(dataDir, 'data', 'vector', `${safe}.json`)
}

// ---------------------------------------------------------------------------
// wf_db_query 工具
// ---------------------------------------------------------------------------

/** 工具层所需宿主能力。 */
export interface DataToolsHost {
  orchestrator: OrchestratorRuntime
  store: FlowStore
  dataDir: string
  engine: EmbeddingEngine
}

/** 查询结果行数上限（防结果集打爆上下文）。 */
const QUERY_ROWS_LIMIT = 50

/** 运行中 run 的定位（root 按会话 / 子代理按 childIndex 反查）。 */
function resolveActiveRun(
  orchestrator: OrchestratorRuntime,
  caller: CallerInfo,
  exec: ToolExecLike,
): { run: NonNullable<ReturnType<OrchestratorRuntime['activeRunForSession']>>; callerNodeId: string } {
  if (caller.isChild) {
    const childId = String((exec.agent as { id?: unknown } | null | undefined)?.id ?? '')
    const meta = childId ? orchestrator.childMetaFor(childId) : null
    if (!meta) throw new WfError('调用者不属于任何正在运行的工作流', 'WF_NO_ACTIVE_RUN')
    let run = null
    for (const entry of orchestrator.runs.values()) {
      const snapshot = entry.snapshot
      if (snapshot.sessionId === meta.sessionId && snapshot.flowId === meta.flowId && snapshot.status === 'running') {
        run = entry
        break
      }
    }
    if (!run) throw new WfError('该工作流已停止，无法访问数据库', 'WF_STOPPED')
    return { run, callerNodeId: meta.nodeId }
  }
  const run = caller.sessionId ? orchestrator.activeRunForSession(caller.sessionId) : null
  if (!run) throw new WfError('当前没有正在运行的工作流编排上下文', 'WF_NO_ACTIVE_RUN')
  return { run, callerNodeId: '' }
}

/** 定位调用者节点 id（root 调用时解析父代理节点；无父代理节点返回空）。 */
function callerNodeIdOf(flow: WorkflowDocument, caller: CallerInfo, childNodeId: string): string {
  if (caller.isChild) return childNodeId
  const parent = flow.nodes.find((node): node is RoleNode => node.kind === 'parent')
  return parent?.id ?? ''
}

/** 工具定义注册（全局层；disposer 随 fiber 注销）。 */
export function registerDataTools(ctx: { get(name: string): unknown }, host: DataToolsHost): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_db_query')
  }

  const definition = defineTool({
    name: WF_DB_QUERY,
    description:
      'Query a database node of the active Visual Workflow run. Use only while an orchestration is running and your node is connected to the database via a db-in edge: pass the database node id and pick a mode — ' +
      '"search" (local SQLite vector retrieval; falls back to BM25 when the embedding model is unavailable), ' +
      '"query" (read-only SELECT with a mandatory LIMIT; local or server databases), or "schema" (read-only table list). ' +
      'Rejected with WF_DB_* codes for nodes without a db-in edge to the data node, blocked SQL, missing index, or after the run stops.',
    parameters: {
      dataId: { type: 'string', required: true, description: 'Database node id from the flow definition file (nodes[].id).' },
      mode: { type: 'string', required: true, enum: ['search', 'query', 'schema'] as const, description: 'search: vector retrieval; query: read-only SELECT; schema: table list.' },
      query: { type: 'string', description: 'Free-text query for mode "search" (required there).' },
      sql: { type: 'string', description: 'Read-only SQL (single SELECT with LIMIT) for mode "query" (required there).' },
      topK: { type: 'number', description: 'Top hits for mode "search" (default 5, max 50).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dataId: { type: 'string', required: true, description: 'The queried database node id.' },
          mode: { type: 'string', required: true, enum: ['search', 'query', 'schema'] as const, description: 'Echo of the requested mode.' },
          source: { type: 'string', description: '"embedding" or "bm25" (bm25 marks non-semantic retrieval).' },
          hits: {
            type: 'array',
            description: 'Search hits (mode "search"): index, text, score.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true, description: 'Chunk index in the index file.' },
                text: { type: 'string', required: true, description: 'Chunk text.' },
                score: { type: 'number', required: true, description: 'Similarity score (higher is better).' },
              },
            },
          },
          columns: { type: 'array', items: { type: 'string' }, description: 'Result column names (mode "query").' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Result rows as string values (mode "query", capped).' },
          tables: {
            type: 'array',
            description: 'Table names (mode "schema").',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string', required: true, description: 'Table name.' } },
            },
          },
          truncated: { type: 'boolean', description: 'True when the result set was capped.' },
        },
      },
      render: textRender,
    },
    async execute(args, exec) {
      const caller = callerOf(exec)
      const sessionId = caller.sessionId
      if (!sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_ARGS')
      const dataId = String(args?.dataId ?? '').trim()
      if (!dataId) throw new WfError('wf_db_query 需要参数 dataId', 'WF_BAD_ARGS')
      const mode = String(args?.mode ?? '')
      if (mode !== 'search' && mode !== 'query' && mode !== 'schema') {
        throw new WfError(`wf_db_query mode 必须是 search/query/schema（收到 ${mode}）`, 'WF_BAD_ARGS')
      }

      // 归属校验：调用者必须属于当前运行中的工作流
      const { run, callerNodeId: childNodeId } = resolveActiveRun(host.orchestrator, caller, exec)
      const flow = await host.orchestrator.currentResolvedFlow(run)
      const callerNodeId = callerNodeIdOf(flow, caller, childNodeId)
      const dataNode = flow.nodes.find((node): node is DatabaseNode => node.id === dataId && node.kind === 'database')
      if (!dataNode) throw new WfError(`数据节点不存在或已从画布移除：${dataId}`, 'WF_DB_BAD_DATA')
      // 连线校验：调用者节点必须经 db-in 接入该数据节点（无连线拒绝）
      if (!callerNodeId || !dbInEdges(flow, callerNodeId).some((line) => line.source === dataId)) {
        throw new WfError('当前节点未通过数据库连线接入该数据节点，无法访问', 'WF_DB_NO_LINE')
      }
      host.orchestrator.touchRun(run)

      if (mode === 'search') {
        if (dataNode.data.dbType !== 'local') {
          throw new WfError('仅本地 SQLite 数据库支持向量检索（服务器类型请用 query/schema）', 'WF_DB_MODE')
        }
        const queryText = String(args?.query ?? '').trim()
        if (!queryText) throw new WfError('wf_db_query mode=search 需要参数 query', 'WF_BAD_ARGS')
        const index = new VectorIndex(indexPathOf(host.dataDir, dataId))
        const result = await index.search(queryText, Number(args?.topK) || 5, host.engine)
        if (!result) throw new WfError('数据库索引未建立：请先在数据库面板为该数据节点建立索引', 'WF_DB_INDEX_MISSING')
        return { dataId, mode: 'search', source: result.source, hits: result.hits }
      }

      if (mode === 'query') {
        const sql = String(args?.sql ?? '')
        const checked = sanitizeReadOnlySql(sql)
        if (!checked.ok) throw new WfError(`SQL 被拒绝：${checked.error}`, 'WF_DB_SQL')
        const driver = createDatabaseDriver(dataNode)
        try {
          const result = await driver.query(checked.sql)
          const truncated = result.rows.length > QUERY_ROWS_LIMIT
          const rows = result.rows.slice(0, QUERY_ROWS_LIMIT)
          return { dataId, mode: 'query', columns: result.columns, rows, ...(truncated ? { truncated: true } : {}) }
        } finally {
          driver.close()
        }
      }

      // mode === 'schema'
      const driver = createDatabaseDriver(dataNode)
      try {
        const tables = await driver.schema()
        return { dataId, mode: 'schema', tables }
      } finally {
        driver.close()
      }
    },
  })

  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为
    }
  }
}
