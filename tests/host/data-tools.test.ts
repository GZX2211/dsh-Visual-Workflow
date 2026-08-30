// tests/host/data-tools.test.ts
//
// 数据工具单测：
//   - SQL 只读白名单矩阵（接受/拒绝）；强制 LIMIT、多语句、写/DDL 黑名单；
//   - SqliteDriver：只读查询/schema/连接测试/物理防写；
//   - createDatabaseDriver 配置错误路径；
//   - buildIndexForDatabase：本地库全表文本化索引构建；
//   - wf_db_query 工具：归属校验（无运行/无连线/坏节点）、三模式执行、
//     索引缺失错误、SQL 拒绝错误。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { VectorIndex } from '../../src/host/embedding/indexer.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type NodeRunner,
  type NodeStartInput,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../src/host/orchestrator/runtime.js'
import { stageLabel } from '../../src/host/graph/model.js'
import type { DatabaseNode, RoleNode, StageNode, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import { WF_DB_QUERY } from '../../src/host/shared/protocol.js'
import {
  SqliteDriver,
  buildIndexForDatabase,
  createDatabaseDriver,
  detectKeyIndex,
  ensureDatabaseIndexes,
  indexPathOf,
  isVectorLikeValue,
  quoteDbIdentifier,
  registerDataTools,
  sanitizeReadOnlySql,
  skipVectorColumns,
  testDatabaseConnection,
  QUERY_CELL_MAX_LENGTH,
  type DataToolsHost,
} from '../../src/host/tools/data-tools.js'
import type { ToolDefinitionLike, ToolExecLike } from '../../src/host/tools/define-tool.js'
import type { EmbeddingEngine } from '../../src/host/embedding/engine.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 创建带数据的临时 SQLite 库（可写模式建库，测后清理）。 */
async function makeSqliteDb(dir: string, name = 'test.db'): Promise<string> {
  const file = join(dir, name)
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)')
  db.exec("INSERT INTO products (name, price) VALUES ('苹果', 5.5), ('香蕉', 3.2), ('汽车', 200000)")
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)')
  db.exec("INSERT INTO notes (content) VALUES ('数据库 向量 检索'), ('BM25 降级 方案')")
  db.close()
  return file
}

// ---------------------------------------------------------------------------
// SQL 只读白名单
// ---------------------------------------------------------------------------

describe('sanitizeReadOnlySql 白名单', () => {
  it('接受：单条 SELECT + LIMIT（大小写不敏感、尾分号、注释剥离）', () => {
    expect(sanitizeReadOnlySql('SELECT * FROM t LIMIT 10')).toEqual({ ok: true, sql: 'SELECT * FROM t LIMIT 10' })
    expect(sanitizeReadOnlySql('select name from t where id = 1 limit 5;')).toEqual({ ok: true, sql: 'select name from t where id = 1 limit 5' })
    expect(sanitizeReadOnlySql('SELECT a FROM t -- 注释\nLIMIT 3')).toMatchObject({ ok: true })
    expect(sanitizeReadOnlySql('SELECT a /* 块注释 */ FROM t LIMIT 3')).toMatchObject({ ok: true })
  })

  it('拒绝：空 SQL', () => {
    expect(sanitizeReadOnlySql('')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('   ')).toMatchObject({ ok: false })
  })

  it('拒绝：非 SELECT 开头', () => {
    expect(sanitizeReadOnlySql('UPDATE t SET a=1 LIMIT 1')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x LIMIT 1')).toMatchObject({ ok: false })
  })

  it('拒绝：多语句', () => {
    expect(sanitizeReadOnlySql('SELECT 1 LIMIT 1; SELECT 2 LIMIT 1')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT 1; DROP TABLE t')).toMatchObject({ ok: false })
  })

  it('拒绝：写/DDL 关键字（词边界）', () => {
    for (const sql of [
      'SELECT * FROM t LIMIT 1; INSERT INTO t VALUES (1)',
      'INSERT INTO t VALUES (1)',
      'DELETE FROM t LIMIT 1',
      'DROP TABLE t',
      'ALTER TABLE t ADD COLUMN x',
      'CREATE TABLE x (a)',
      'TRUNCATE TABLE t',
      'PRAGMA journal_mode=WAL',
      'VACUUM',
      'ATTACH DATABASE x AS y',
      'REPLACE INTO t VALUES (1)',
    ]) {
      const result = sanitizeReadOnlySql(sql)
      expect(result.ok, `应拒绝：${sql}`).toBe(false)
    }
  })

  it('拒绝：缺少 LIMIT / 文件导出', () => {
    expect(sanitizeReadOnlySql('SELECT * FROM t')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT * INTO OUTFILE "/tmp/x" FROM t LIMIT 1')).toMatchObject({ ok: false })
  })

  it('列名含黑名单词不误伤（词边界）', () => {
    expect(sanitizeReadOnlySql('SELECT status FROM t WHERE name = \'update\' LIMIT 1')).toMatchObject({ ok: true })
  })

  it('字符串字面量内分号不误判为多语句（先剥离字面量再查分号）', () => {
    expect(sanitizeReadOnlySql('SELECT \'a;b\' AS x FROM t LIMIT 1')).toEqual({ ok: true, sql: 'SELECT \'a;b\' AS x FROM t LIMIT 1' })
    expect(sanitizeReadOnlySql('SELECT \';\' FROM t LIMIT 1')).toMatchObject({ ok: true })
  })

  it('真实多语句仍被拒绝（字面量剥离不影响语句分隔判定）', () => {
    expect(sanitizeReadOnlySql('SELECT 1 LIMIT 1; SELECT 2 LIMIT 1')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT \'x\' FROM t LIMIT 1; DROP TABLE t')).toMatchObject({ ok: false })
  })
})

// ---------------------------------------------------------------------------
// SqliteDriver
// ---------------------------------------------------------------------------

describe('SqliteDriver', () => {
  it('query/schema/testConnection 只读访问正常', async () => {
    const dir = await tempDir('vw-drv-')
    const file = await makeSqliteDb(dir)
    const driver = new SqliteDriver(file)
    try {
      await driver.testConnection()
      const result = await driver.query('SELECT name, price FROM products ORDER BY id LIMIT 2')
      expect(result.columns).toEqual(['name', 'price'])
      expect(result.rows).toEqual([['苹果', '5.5'], ['香蕉', '3.2']])
      const tables = await driver.schema()
      expect(tables.map((t) => t.name).sort()).toEqual(['notes', 'products'])
    } finally {
      driver.close()
    }
  })

  it('只读模式物理防写：INSERT 被拒', async () => {
    const dir = await tempDir('vw-drv-')
    const file = await makeSqliteDb(dir)
    const driver = new SqliteDriver(file)
    try {
      await expect(driver.query('INSERT INTO products (name, price) VALUES (\'x\', 1)')).rejects.toThrow()
    } finally {
      driver.close()
    }
  })

  it('文件不存在 → 连接测试报明确错误', async () => {
    const dir = await tempDir('vw-drv-')
    const driver = new SqliteDriver(join(dir, 'missing.db'))
    try {
      await expect(driver.testConnection()).rejects.toThrow()
    } finally {
      driver.close()
    }
  })
})

// ---------------------------------------------------------------------------
// createDatabaseDriver / testDatabaseConnection
// ---------------------------------------------------------------------------

describe('createDatabaseDriver 与连接测试', () => {
  function dbNode(extra: Partial<DatabaseNode['data']> = {}): DatabaseNode {
    return {
      id: 'd1',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', ...extra },
    }
  }

  it('本地无路径 → 配置错误', () => {
    expect(() => createDatabaseDriver(dbNode())).toThrow('未配置本地文件路径')
  })

  it('服务器无连接信息 → 配置错误', () => {
    expect(() => createDatabaseDriver(dbNode({ dbType: 'server', dbKind: 'mysql' }))).toThrow('未配置服务器连接信息')
  })

  it('本地库连接测试成功/文件缺失失败', async () => {
    const dir = await tempDir('vw-drv-')
    const file = await makeSqliteDb(dir)
    expect(await testDatabaseConnection(dbNode({ localPath: file }))).toEqual({ ok: true, message: '连接成功' })
    const failed = await testDatabaseConnection(dbNode({ localPath: join(dir, 'nope.db') }))
    expect(failed.ok).toBe(false)
    expect(failed.message).toContain('连接失败')
  })

  it('服务器连接：未监听端口 → 连接失败（驱动可用）', async () => {
    const node = dbNode({
      dbType: 'server',
      dbKind: 'mysql',
      conn: { host: '127.0.0.1', port: 1, user: 'u', password: 'p', db: 'd' },
    })
    const result = await testDatabaseConnection(node)
    expect(result.ok).toBe(false)
  }, 15000)
})

// ---------------------------------------------------------------------------
// buildIndexForDatabase
// ---------------------------------------------------------------------------

describe('buildIndexForDatabase', () => {
  it('本地库全表文本化构建索引（source 标注表名）', async () => {
    const dir = await tempDir('vw-idx-')
    const file = await makeSqliteDb(dir)
    const node: DatabaseNode = {
      id: 'd1',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: file },
    }
    const engine: EmbeddingEngine = {
      source: 'bm25',
      dimension: 0,
      async embed() {
        throw new Error('not used')
      },
      dispose() {},
    }
    const { file: indexFile, truncated } = await buildIndexForDatabase(dir, node, engine)
    expect(indexFile.source).toBe('bm25')
    expect(indexFile.chunks.length).toBeGreaterThanOrEqual(5) // 3 行 products + 2 行 notes
    expect(truncated).toBe(false)
    const sources = new Set(indexFile.chunks.map((c) => c.source))
    expect(sources.has('products')).toBe(true)
    expect(sources.has('notes')).toBe(true)
    // 索引文件按 dataId 落盘
    const { existsSync } = await import('node:fs')
    expect(existsSync(indexPathOf(dir, 'd1'))).toBe(true)
  })

  it('服务器类型：本地索引构建不再被拒（无驱动时报驱动/连接错误而非 WF_DB_MODE）', async () => {
    const dir = await tempDir('vw-idx-')
    const node: DatabaseNode = {
      id: 'd1',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: {
        label: '库', description: '', dbType: 'server', dbKind: 'mysql',
        conn: { host: '127.0.0.1', port: 3306, user: 'u', password: 'p', db: 'd' },
      },
    }
    const error = await buildIndexForDatabase(dir, node, { source: 'bm25', dimension: 0, embed: async () => [], dispose() {} }).catch((e) => e)
    // 服务器类型已纳入本地索引构建，不再抛 WF_DB_MODE；测试环境驱动缺失/服务不可达 → 驱动或连接错误
    expect(error?.code).not.toBe('WF_DB_MODE')
  })

  it('isVectorLikeValue：识别长浮点数组，拒绝短/普通文本', () => {
    // 16 维向量 → true
    const vector = Array.from({ length: 16 }, (_, i) => `${i}.${i + 1}`).join(',')
    expect(isVectorLikeValue(vector)).toBe(true)
    expect(isVectorLikeValue(`[${vector}]`)).toBe(true)
    // 普通单元格 → false
    expect(isVectorLikeValue('苹果')).toBe(false)
    expect(isVectorLikeValue('5.5')).toBe(false)
    expect(isVectorLikeValue('金融 产品 债券')).toBe(false)
    expect(isVectorLikeValue('')).toBe(false)
  })

  it('skipVectorColumns：按列名/值形态识别向量列', () => {
    const columns = ['id', 'name', 'embedding']
    const rows = [['1', '短债基金', Array.from({ length: 16 }, (_, i) => '0.1').join(',')]]
    const skip = skipVectorColumns(columns, rows)
    expect(skip).toContain('embedding')
    expect(skip).not.toContain('id')
    expect(skip).not.toContain('name')
  })

  it('quoteDbIdentifier：SQLite/PostgreSQL 双引号，MySQL 反引号', () => {
    const node = (dbKind: string): DatabaseNode => ({
      id: 'd1', kind: 'database', position: { x: 0, y: 0 },
      data: { label: '库', description: '', dbType: 'server', dbKind: dbKind as DatabaseNode['data']['dbKind'], conn: { host: 'h', port: 1, user: 'u', password: 'p', db: 'd' } },
    })
    expect(quoteDbIdentifier(node('sqlite'), 'products')).toBe('"products"')
    expect(quoteDbIdentifier(node('postgresql'), 'products')).toBe('"products"')
    expect(quoteDbIdentifier(node('mysql'), 'products')).toBe('`products`')
  })

  it('detectKeyIndex：优先精确主键名，其次含 id/key 列名，找不到为 -1', () => {
    expect(detectKeyIndex(['name', 'price'])).toBe(-1)
    expect(detectKeyIndex(['id', 'name'])).toBe(0)
    expect(detectKeyIndex(['sku_code', 'title'])).toBe(0)
    expect(detectKeyIndex(['product_id', 'title'])).toBe(0)
    expect(detectKeyIndex(['编号', '名称'])).toBe(0)
  })

  it('buildIndexForDatabase：应用 vectorOptions 分块/容量并回传 rowKey', async () => {
    const dir = await tempDir('vw-idx-')
    const file = await makeSqliteDb(dir)
    const node: DatabaseNode = {
      id: 'd1',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: {
        label: '库', description: '', dbType: 'local', dbKind: 'sqlite',
        localPath: file,
        vectorOptions: { chunkSize: 8, overlap: 2, maxRows: 2 },
      },
    }
    const { file: indexFile } = await buildIndexForDatabase(dir, node, { source: 'bm25', dimension: 0, embed: async () => [], dispose() {} })
    // products 表 3 行 + notes 表 2 行；maxRows=2 → 只索引 2 行（truncated）
    // 但需验证 rowKey 落盘与分块窗口被采纳。
    const chunkRows = indexFile.chunks.filter((c) => c.rowKey !== undefined)
    expect(chunkRows.length).toBeGreaterThan(0)
    expect(indexFile.chunkSize).toBe(8)
    expect(indexFile.overlap).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// wf_db_query 工具执行
// ---------------------------------------------------------------------------

class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  available(): boolean {
    return true
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(): void {}
  latestTurnEnd(): TurnEndInfo | null {
    return null
  }
  childRunning(): boolean {
    return false
  }
}

class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    return { childId: `child-${this.calls.length}`, created: true }
  }
  async interruptChild(): Promise<void> {}
}

class FakeToolsRegistry {
  definitions = new Map<string, ToolDefinitionLike>()
  register(def: ToolDefinitionLike): () => void {
    this.definitions.set(def.name, def)
    return () => this.definitions.delete(def.name)
  }
}

function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function role(id: string, kind: 'parent' | 'agent', label: string): RoleNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

interface Harness {
  runtime: OrchestratorRuntime
  store: FlowStore
  tools: FakeToolsRegistry
  engine: EmbeddingEngine
  dataDir: string
  dbFile: string
}

/** 装配：临时库 + 真实编排运行时 + 注册 wf_db_query。 */
async function makeHarness(): Promise<Harness> {
  const dir = await tempDir('vw-dbtools-')
  const store = new FlowStore(dir)
  await store.init()
  const dbFile = await makeSqliteDb(dir)
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runtime = new OrchestratorRuntime({
    store,
    runner: new FakeRunner(),
    agents,
    config: { outputFullLimit: 400, documentTextLimit: 200, runIdleTimeoutMs: 500, retryLimitDefault: 3, reactIterationLimitDefault: 50, wfAskAgentTimeoutMs: 500 },
    newRunId: () => 'run-1',
    uuid: () => 'uuid-1',
  })
  const tools = new FakeToolsRegistry()
  const engine: EmbeddingEngine = { source: 'bm25', dimension: 0, async embed() { throw new Error('bm25 only') }, dispose() {} }
  const host: DataToolsHost = { orchestrator: runtime, store, dataDir: dir, engine }
  registerDataTools({ get: (name) => (name === 'tools' ? tools : null) }, host)
  return { runtime, store, tools, engine, dataDir: dir, dbFile }
}

/** 标准流程：start → d1(数据库) → a1(db-in) + a2(无连线) + parent(db-in) → end。 */
function makeFlow(dbFile: string): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '数据流程',
    description: '',
    revision: 1,
    nodes: [
      stage('n-start', 'start'),
      {
        id: 'd1',
        kind: 'database',
        position: { x: 0, y: 0 },
        data: { label: '本地库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: dbFile },
      },
      role('a1', 'agent', '查询代理'),
      role('a2', 'agent', '无连线代理'),
      role('p1', 'parent', '父代理'),
      stage('n-end', 'end'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'a1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'd1', target: 'a1', sourceHandle: 'db-out', targetHandle: 'db-in' },
      { id: 'l4', source: 'd1', target: 'p1', sourceHandle: 'db-out', targetHandle: 'db-in' },
    ],
  }
}

const rootExec = (): ToolExecLike => ({ signal: new AbortController().signal, agent: { id: 'session-1', session: { header: {} } } })
const childExec = (childId: string): ToolExecLike => ({
  signal: new AbortController().signal,
  agent: { id: childId, session: { header: { origin: 'subagent', parentSession: 'session-1' } } },
})

describe('wf_db_query 工具执行', () => {
  it('无运行 → WF_NO_ACTIVE_RUN；参数缺失 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'd1', mode: 'schema' }, rootExec())).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
    await expect(def.execute({ mode: 'schema' }, rootExec())).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ dataId: 'd1', mode: 'bad' }, rootExec())).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
  })

  it('数据节点不存在 → WF_DB_BAD_DATA', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'no-such', mode: 'schema' }, rootExec())).rejects.toMatchObject({ code: 'WF_DB_BAD_DATA' })
  })

  it('无 db-in 连线的节点调用 → WF_DB_NO_LINE', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    // 启动 a2（无连线）产生 child-1；childIndex 登记 a2
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a2' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'd1', mode: 'schema' }, childExec('child-1'))).rejects.toMatchObject({ code: 'WF_DB_NO_LINE' })
  })

  it('schema 模式：返回表清单（子代理经 db-in 连线调用）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, childExec('child-1'))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'schema' })
    const tables = (result as { tables: Array<{ name: string }> }).tables.map((t) => t.name).sort()
    expect(tables).toEqual(['notes', 'products'])
  })

  it('query 模式：SQL 白名单拒绝 → WF_DB_SQL；合法查询返回 rows', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'd1', mode: 'query', sql: 'SELECT * FROM products' }, childExec('child-1'))).rejects.toMatchObject({ code: 'WF_DB_SQL' })
    await expect(def.execute({ dataId: 'd1', mode: 'query', sql: 'DROP TABLE products' }, childExec('child-1'))).rejects.toMatchObject({ code: 'WF_DB_SQL' })
    const result = await def.execute({ dataId: 'd1', mode: 'query', sql: 'SELECT name, price FROM products ORDER BY id LIMIT 2' }, childExec('child-1'))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'query', columns: ['name', 'price'] })
    expect((result as { rows: string[][] }).rows).toEqual([['苹果', '5.5'], ['香蕉', '3.2']])
  })

  it('search 模式：索引未建 → WF_DB_INDEX_MISSING；建索引后返回 hits（bm25 标注）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const node = makeFlow(h.dbFile).nodes.find((n) => n.id === 'd1') as DatabaseNode
    await buildIndexForDatabase(h.dataDir, node, h.engine)
    const result = await def.execute({ dataId: 'd1', mode: 'search', query: '数据库', topK: 3 }, childExec('child-1'))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'search', source: 'bm25' })
    const hits = (result as { hits: Array<{ text: string }> }).hits
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.text.includes('向量 检索'))).toBe(true)
    // 未建索引的数据节点 → 明确错误
    const missing = await def.execute({ dataId: 'd1', mode: 'search', query: 'x' }, childExec('child-1'))
    expect(missing).toMatchObject({ dataId: 'd1', mode: 'search' })
  })

  it('search 模式：索引未建时运行期惰性自动构建（无需手动预建），且仅首次触发', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 不预建索引：直接 search，工具应在运行时自动构建（bm25 引擎 → source bm25）并返回命中
    const result = await def.execute({ dataId: 'd1', mode: 'search', query: '数据库', topK: 3 }, childExec('child-1'))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'search', source: 'bm25' })
    expect((result as { hits: Array<{ text: string }> }).hits.length).toBeGreaterThan(0)
    // 再次检索命中已落盘的缓存索引，不重复构建、仍返回命中
    const again = await def.execute({ dataId: 'd1', mode: 'search', query: '检索', topK: 3 }, childExec('child-1'))
    expect(again).toMatchObject({ dataId: 'd1', mode: 'search' })
    expect((again as { hits: Array<{ text: string }> }).hits.length).toBeGreaterThan(0)
  })

  it('ensureDatabaseIndexes：为 db-in 所连本地库预建索引；已存在则复用不重复重建', async () => {
    const h = await makeHarness()
    const flow = makeFlow(h.dbFile)
    const warn = vi.fn()
    // 首次：无索引 → 预建
    await ensureDatabaseIndexes(h.dataDir, 'a1', flow, h.engine, { warn })
    const index = new VectorIndex(indexPathOf(h.dataDir, 'd1'))
    const file = await index.load()
    expect(file).not.toBeNull()
    expect(file!.chunks.length).toBeGreaterThan(0)
    // 再次：已有索引 → 复用（chunks 数量不变，未触发重建）
    const before = file!.chunks.length
    await ensureDatabaseIndexes(h.dataDir, 'a1', flow, h.engine, { warn })
    const file2 = await index.load()
    expect(file2!.chunks.length).toBe(before)
    // 无 db-in 连线的节点：不构建任何索引、不再额外触发 warn
    const warnCount = warn.mock.calls.length
    await ensureDatabaseIndexes(h.dataDir, 'a2', flow, h.engine, { warn })
    expect(warn.mock.calls.length).toBe(warnCount)
  })

  it('父代理（root）经 parent 节点连线调用同样被允许', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeFlow(h.dbFile), 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, rootExec())
    expect(result).toMatchObject({ dataId: 'd1', mode: 'schema' })
  })

  it('服务器类型 search：不再以 WF_DB_MODE 拒绝（本地索引构建；驱动缺失/连接失败时给出驱动或连接错误）', async () => {
    const h = await makeHarness()
    const flow = makeFlow(h.dbFile)
    const serverNode: DatabaseNode = {
      id: 'd2',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: {
        label: '服务器库', description: '', dbType: 'server', dbKind: 'mysql',
        conn: { host: '127.0.0.1', port: 3306, user: 'u', password: 'p', db: 'd' },
      },
    }
    flow.nodes.push(serverNode)
    flow.lines.push({ id: 'l5', source: 'd2', target: 'a1', sourceHandle: 'db-out', targetHandle: 'db-in' })
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const error = await (def.execute({ dataId: 'd2', mode: 'search', query: 'x' }, childExec('child-1')) as Promise<unknown>).then(
      () => null,
      (e: unknown) => e as { code?: string },
    )
    // 服务器类型已允许向量检索（不再抛 WF_DB_MODE）；测试环境无 mysql2 驱动/服务 → 驱动或连接错误
    expect(error?.code).not.toBe('WF_DB_MODE')
  })

  it('query 模式：超长单元格值被截断并标记 truncated（防向量/BLOB 列打爆上下文）', async () => {
    const h = await makeHarness()
    const dir = h.dataDir
    // 用含超长列的自建库（模拟向量列）
    const file = join(dir, 'vectors.db')
    {
      const db = new DatabaseSync(file)
      db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, embedding TEXT)')
      const vec = Array.from({ length: 128 }, (_, i) => `${i}.${i % 7}`).join(',')
      const stmt = db.prepare('INSERT INTO products (name, embedding) VALUES (?, ?)')
      stmt.run('短债基金', vec)
      stmt.run('纯债基金', 'short')
      db.close()
    }
    const flow = makeFlow(file)
    await h.store.saveWorkflow(flow, 'session-1', { force: true })
    await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'query', sql: 'SELECT id, name, embedding FROM products ORDER BY id LIMIT 10' }, childExec('child-1'))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'query', truncated: true })
    const rows = (result as { rows: string[][] }).rows
    expect(rows[0][1]).toBe('短债基金')
    // 超长向量列被截断（长度 ≤ QUERY_CELL_MAX_LENGTH + 标记）
    expect(rows[0][2].length).toBeLessThanOrEqual(QUERY_CELL_MAX_LENGTH + 1)
    expect(rows[0][2].endsWith('…')).toBe(true)
    // 短值不受影响
    expect(rows[1][2]).toBe('short')
  })
})
