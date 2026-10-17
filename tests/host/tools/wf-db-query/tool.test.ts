// tests/host/tools/wf-db-query/tool.test.ts
//
// wf_db_query 工具（tool.ts）单测：注册面（参数/输出 schema/description W-03）与
// 三模式执行、归属校验（运行态解耦/无实例/坏节点/无连线）、SQL 与索引错误路径。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync, StatementSync, type SQLOutputValue } from 'node:sqlite'
import type { EmbeddingEngine } from '../../../../src/host/embedding/engine.js'
import type { DatabaseNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import { WF_DB_QUERY } from '../../../../src/host/shared/protocol.js'
import { SEARCH_TOP_K_MAX } from '../../../../src/host/embedding/indexer.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { SCHEMA_TABLE_LIMIT } from '../../../../src/host/tools/wf-db-query/driver.js'
import { indexPathOf } from '../../../../src/host/tools/wf-db-query/service.js'
import { registerWfDbQuery, QUERY_CELL_MAX_LENGTH, QUERY_ROWS_LIMIT } from '../../../../src/host/tools/wf-db-query/tool.js'
import type { WfDbQueryHost, DatabaseDriver } from '../../../../src/host/tools/wf-db-query/types.js'
import { makeDbFlow, makeSqliteDb } from '../fixtures/db-fixture.js'
import {
  childAgent,
  cleanupTempDirs,
  execOf,
  makeEnv,
  registerTools,
  rootAgent,
  type TestEnv,
} from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

/** 建一个含 count 张表的临时 SQLite 库（schema 上限边界用）。 */
function makeTableDb(file: string, count: number): void {
  const db = new DatabaseSync(file)
  try {
    for (let i = 0; i < count; i += 1) {
      db.exec(`CREATE TABLE t${String(i).padStart(4, '0')} (id INTEGER PRIMARY KEY)`)
    }
  } finally {
    db.close()
  }
}

/** 建一个含 count 行的临时 SQLite 库（查询执行层行数上限用；行数可远超上限）。 */
function makeRowDb(file: string, count: number): void {
  const db = new DatabaseSync(file)
  try {
    db.exec('CREATE TABLE lots (id INTEGER PRIMARY KEY, payload TEXT)')
    db.exec(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${count})
       INSERT INTO lots (id, payload) SELECT n, 'r' || n FROM seq`,
    )
  } finally {
    db.close()
  }
}

/**
 * 给 `StatementSync.iterate` 加计数包装：返回真实迭代器，但统计 `next()` 被调用了几次
 * ——即语句实际推进的行数，是「工具查询路径只读取到上限行」的可观察证据。
 * 未把行数上限下推到执行层（或驱动退回 `.all()` 全量物化）时，计数为 0。
 */
function spyOnIterate(): { nextCalls: () => number; restore: () => void } {
  const original = StatementSync.prototype.iterate as unknown as
    (this: StatementSync) => NodeJS.Iterator<Record<string, SQLOutputValue>>
  let nextCalls = 0
  const spy = vi.spyOn(StatementSync.prototype, 'iterate').mockImplementation(function (this: StatementSync) {
    const inner = original.call(this)
    return {
      next: () => {
        nextCalls += 1
        return inner.next()
      },
      [Symbol.iterator]() {
        return this
      },
    } as unknown as ReturnType<typeof original>
  })
  return { nextCalls: () => nextCalls, restore: () => spy.mockRestore() }
}

/** 降级引擎替身（bm25：不做嵌入）。 */
const engine: EmbeddingEngine = { source: 'bm25', dimension: 0, async ensureReady() {}, async embed() { throw new Error('bm25 only') }, dispose() {} }

interface DbHarness extends TestEnv {
  host: WfDbQueryHost
  engine: EmbeddingEngine
  dataDir: string
  dbFile: string
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 临时 SQLite 库 + 注册 wf_db_query（hostOverrides 注入宿主缝）。 */
async function makeHarness(hostOverrides: Partial<WfDbQueryHost> = {}): Promise<DbHarness> {
  const env = await makeEnv()
  const dbFile = await makeSqliteDb(env.dir)
  const host: WfDbQueryHost = { orchestrator: env.runtime, store: env.store, dataDir: env.dir, engine, ...hostOverrides }
  const disposeTools = registerTools(env, host, [registerWfDbQuery])
  return { ...env, host, engine, dataDir: env.dir, dbFile, disposeTools }
}

/** 保存流程并启动运行。 */
async function start(h: DbHarness, flow: WorkflowDocument = makeDbFlow(h.dbFile)): Promise<void> {
  await h.store.saveWorkflow(flow, 'session-1', { force: true })
  await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
}

describe('wf_db_query 注册与 schema', () => {
  it('注册 wf_db_query 并可通过 disposer 注销（注册表仅含该工具）', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_DB_QUERY])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_DB_QUERY)).toBe(true)
  })

  it('parameters：dataId/mode 必填，mode 为三态枚举，query/sql/topK 可选', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    expect(def.parameters.required).toEqual(['dataId', 'mode'])
    expect(Object.keys(def.parameters.properties ?? {}).sort()).toEqual(['dataId', 'mode', 'query', 'sql', 'topK'].sort())
    expect((def.parameters.properties ?? {}).mode).toMatchObject({ enum: ['search', 'query', 'schema'] })
  })

  it('topK 参数说明：取值域上限与 SEARCH_TOP_K_MAX 同源（数字随常量走，不漂移）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const description = String((def.parameters.properties ?? {}).topK?.description ?? '')
    // 同源断言：取值域里的上限数字必须来自检索上限常量本体（不锁定整句文案）
    expect(description).toContain(String(SEARCH_TOP_K_MAX))
  })

  it('output.schema：对象 additionalProperties=false、required 提取、mode 枚举保留', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_DB_QUERY)!.output.schema as JsonSchemaNode
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['dataId', 'mode'])
    expect((schema.properties ?? {}).mode).toMatchObject({ enum: ['search', 'query', 'schema'] })
  })

  it('description 符合官方标准英文（W-03：英文主体、精炼）', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_DB_QUERY)!.description
    expect(description.length).toBeGreaterThan(20)
    const ascii = [...description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / description.length).toBeGreaterThan(0.9)
    // 文案已精简至 W-03 口径（原 139 词偏差随本轮提示词优化收敛），恢复标准上限门禁
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(130)
  })
})

describe('wf_db_query 工具执行', () => {
  it('无运行态：主代理仍可查询（运行态解耦）；参数缺失/非法 → WF_BAD_ARGS', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeDbFlow(h.dbFile), 'session-1', { force: true })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 运行锁降权（用户裁决）：主代理在画布连好数据库后不必先点运行即可查询
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, execOf(rootAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'schema' })
    const tables = (result as { tables: Array<{ name: string }> }).tables.map((t) => t.name).sort()
    expect(tables).toEqual(['notes', 'products'])
    await expect(def.execute({ mode: 'schema' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    await expect(def.execute({ dataId: 'd1', mode: 'bad' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
  })

  it('无法识别调用方会话 → WF_BAD_CALLER（唯一稳定码，码写进模型可见 message）', async () => {
    const h = await makeHarness()
    await h.store.saveWorkflow(makeDbFlow(h.dbFile), 'session-1', { force: true })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 官方 ToolExecLike.agent 可选：无会话身份的调用在入口被拒。
    // 同一事实只允许一个稳定码（会话可解耦出流程，但流程定位不了调用方）。
    const error = await (def.execute({ dataId: 'd1', mode: 'schema' }, execOf({ id: '', session: { header: {} } })) as Promise<unknown>).then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string },
    )
    expect(error?.code).toBe('WF_BAD_CALLER')
    expect(String(error?.message)).toContain('WF_BAD_CALLER')
  })

  it('无运行态：本会话无实例 → WF_NO_INSTANCE；子代理无运行态仍被拒绝', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 从未保存过实例：无运行上下文也无实例可依
    await expect(def.execute({ dataId: 'd1', mode: 'schema' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NO_INSTANCE' })
    // 子代理：节点身份依赖 run（childIndex），无运行 → WF_NO_ACTIVE_RUN
    await h.store.saveWorkflow(makeDbFlow(h.dbFile), 'session-1', { force: true })
    await expect(def.execute({ dataId: 'd1', mode: 'schema' }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('数据节点不存在 → WF_DB_BAD_DATA', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'no-such', mode: 'schema' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_DB_BAD_DATA' })
  })

  it('无 db-in 连线的节点调用 → WF_DB_NO_LINE', async () => {
    const h = await makeHarness()
    await start(h)
    // 启动 a2（无连线）产生 child-1；childIndex 登记 a2
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a2' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'd1', mode: 'schema' }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_DB_NO_LINE' })
  })

  it('schema 模式：返回表清单（子代理经 db-in 连线调用）', async () => {
    const h = await makeHarness()
    await start(h)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, execOf(childAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'schema' })
    const tables = (result as { tables: Array<{ name: string }> }).tables.map((t) => t.name).sort()
    expect(tables).toEqual(['notes', 'products'])
  })

  it('query 模式：SQL 白名单拒绝 → WF_DB_SQL；合法查询返回 rows', async () => {
    const h = await makeHarness()
    await start(h)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(def.execute({ dataId: 'd1', mode: 'query', sql: 'SELECT * FROM products' }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_DB_SQL' })
    await expect(def.execute({ dataId: 'd1', mode: 'query', sql: 'DROP TABLE products' }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_DB_SQL' })
    const result = await def.execute({ dataId: 'd1', mode: 'query', sql: 'SELECT name, price FROM products ORDER BY id LIMIT 2' }, execOf(childAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'query', columns: ['name', 'price'] })
    expect((result as { rows: string[][] }).rows).toEqual([['苹果', '5.5'], ['香蕉', '3.2']])
  })

  it('query 模式：大表超过上限 → 执行层只读「上限 + 1」行，rows 截到上限且 truncated 透传', async () => {
    const h = await makeHarness()
    const file = join(h.dataDir, 'many-rows.db')
    makeRowDb(file, 20000)
    await start(h, makeDbFlow(file))
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const counter = spyOnIterate()
    try {
      const result = await def.execute(
        { dataId: 'd1', mode: 'query', sql: 'SELECT id, payload FROM lots ORDER BY id LIMIT 999999999' },
        execOf(childAgent),
      )
      expect(result).toMatchObject({ dataId: 'd1', mode: 'query', columns: ['id', 'payload'], truncated: true })
      expect((result as { rows: string[][] }).rows).toHaveLength(QUERY_ROWS_LIMIT)
      // 上限下推到执行层的判别性证据：底层语句只被推进 上限 + 1 次（含截断探测）
      expect(counter.nextCalls()).toBe(QUERY_ROWS_LIMIT + 1)
    } finally {
      counter.restore()
    }
  })

  it('query 模式：正好达到上限 → 不出现 truncated 字段（与 search/schema 同一精确口径）', async () => {
    const h = await makeHarness()
    const file = join(h.dataDir, 'exact-rows.db')
    makeRowDb(file, QUERY_ROWS_LIMIT)
    await start(h, makeDbFlow(file))
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute(
      { dataId: 'd1', mode: 'query', sql: 'SELECT id FROM lots ORDER BY id LIMIT 999999999' },
      execOf(childAgent),
    )
    expect((result as { rows: string[][] }).rows).toHaveLength(QUERY_ROWS_LIMIT)
    expect((result as { truncated?: boolean }).truncated).toBeUndefined()
  })

  it('search 模式：有内容但未预建索引 → 惰性自动构建并返回 hits（不报 INDEX_MISSING）', async () => {
    const h = await makeHarness()
    await start(h)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 索引不存在 + 库里有内容：惰性构建必然产出非空 chunks → search 覆盖，不进入 INDEX_MISSING。
    // 「索引未建即报错」的旧语义已由本用例取代（原断言与紧随其后的重复成功断言一并删除）。
    const result = await def.execute({ dataId: 'd1', mode: 'search', query: '数据库', topK: 3 }, execOf(childAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'search', source: 'bm25' })
    const hits = (result as { hits: Array<{ text: string }> }).hits
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.text.includes('向量 检索'))).toBe(true)
  })

  it('search 模式：库里没有可索引内容且索引为空 → WF_DB_INDEX_MISSING（标题所述行为）', async () => {
    const h = await makeHarness()
    // 建表结构但不插任何行：schema() 有表、query 回 0 行 → 惰性构建产出 chunks=[] 的索引文件，
    // 但文件已存在故不会再次构建，search 对空 chunks 返回 null → 确定性触发 WF_DB_INDEX_MISSING。
    await rm(h.dbFile, { force: true })
    const empty = new DatabaseSync(h.dbFile)
    empty.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)')
    empty.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)')
    empty.close()
    await rm(indexPathOf(h.dataDir, 'd1'), { force: true })
    await start(h)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    await expect(
      def.execute({ dataId: 'd1', mode: 'search', query: 'x' }, execOf(childAgent)),
    ).rejects.toMatchObject({ code: 'WF_DB_INDEX_MISSING' })
  })

  it('search 模式：索引未建时运行期惰性自动构建（无需手动预建），且仅首次触发', async () => {
    const h = await makeHarness()
    await start(h)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 不预建索引：直接 search，工具应在运行时自动构建（bm25 引擎 → source bm25）并返回命中
    const result = await def.execute({ dataId: 'd1', mode: 'search', query: '数据库', topK: 3 }, execOf(childAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'search', source: 'bm25' })
    expect((result as { hits: Array<{ text: string }> }).hits.length).toBeGreaterThan(0)
    // 再次检索命中已落盘的缓存索引，不重复构建、仍返回命中
    const again = await def.execute({ dataId: 'd1', mode: 'search', query: '检索', topK: 3 }, execOf(childAgent))
    expect(again).toMatchObject({ dataId: 'd1', mode: 'search' })
    expect((again as { hits: Array<{ text: string }> }).hits.length).toBeGreaterThan(0)
  })

  it('父代理（root）经 parent 节点连线调用同样被允许', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, execOf(rootAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'schema' })
  })

  it('服务器类型 search：不再以 WF_DB_MODE 拒绝（本地索引构建；驱动缺失/连接失败时给出驱动或连接错误）', async () => {
    const h = await makeHarness()
    const flow = makeDbFlow(h.dbFile)
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
    await start(h, flow)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const error = await (def.execute({ dataId: 'd2', mode: 'search', query: 'x' }, execOf(childAgent)) as Promise<unknown>).then(
      () => null,
      (e: unknown) => e as { code?: string },
    )
    // 正向/具名断言：把「测试环境是否装了可选驱动」从隐含前提变成显式期望。
    // 本工作区 mysql2 已装（node_modules/mysql2/package.json 存在）且 127.0.0.1:3306 无服务
    // → 必为连接类错误 code（ECONNREFUSED），而不是驱动缺失码、更不是 WF_DB_MODE。
    // 旧断言 `expect(error?.code).not.toBe('WF_DB_MODE')` 对「返回 null（误判成功）」与
    // 任意非 WfError 异常都恒真，只对一种回归（退回 WF_DB_MODE）敏感，故此处升级为具名断言。
    expect(error, '服务器库检索不应成功返回（无服务端可用）').not.toBeNull()
    expect(error?.code).not.toBe('WF_DB_MODE')
    expect(error?.code, '驱动/错误码必须是连接类具名码').toMatch(/^(ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|WF_DB_DRIVER_MISSING|WF_DB_CONFIG)$/)
    expect(error?.code).not.toBe('WF_DB_DRIVER_MISSING')
  })

  it('服务器库（mysql）：注入驱动工厂后 schema/query/search 三模式可用（D09 缺口的正向锁定）', async () => {
    // fake 驱动只回放固定数据：真实 MySQL/PG 服务在本环境不可提供，此前「服务器库检索可用」
    // 只有反向断言（无服务时必失败），永远无法正向锁定。
    const created: string[] = []
    const fakeDriver: DatabaseDriver = {
      async testConnection() {},
      async query() {
        return { columns: ['id', 'name'], rows: [['1', '向量 检索'], ['2', 'BM25 降级']] }
      },
      async schema() {
        return [{ name: 'users' }]
      },
      async schemaPage() {
        return { tables: [{ name: 'users' }], truncated: false }
      },
      close() {},
    }
    const h = await makeHarness({
      createDriver: (node) => {
        created.push(node.id)
        return fakeDriver
      },
    })
    const flow = makeDbFlow(h.dbFile)
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
    await start(h, flow)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!

    const schema = await def.execute({ dataId: 'd2', mode: 'schema' }, execOf(childAgent))
    expect(schema).toMatchObject({ dataId: 'd2', mode: 'schema' })
    expect((schema as { tables: Array<{ name: string }> }).tables).toEqual([{ name: 'users' }])

    const queried = await def.execute({ dataId: 'd2', mode: 'query', sql: 'SELECT id, name FROM users LIMIT 2' }, execOf(childAgent))
    expect(queried).toMatchObject({ dataId: 'd2', mode: 'query', columns: ['id', 'name'] })
    expect((queried as { rows: string[][] }).rows).toEqual([['1', '向量 检索'], ['2', 'BM25 降级']])

    // search：本地索引经同一驱动工厂构建（服务器库与本地库共用索引基础设施）
    const searched = await def.execute({ dataId: 'd2', mode: 'search', query: '向量' }, execOf(childAgent))
    expect(searched).toMatchObject({ dataId: 'd2', mode: 'search', source: 'bm25' })
    expect((searched as { hits: unknown[] }).hits.length).toBeGreaterThan(0)

    // 三处驱动创建（schema / query / 惰性索引构建）统一经宿主缝解析，无一处绕过
    expect(created).toEqual(['d2', 'd2', 'd2'])
  })

  it('query 模式：超长单元格值被截断并标记 truncated（防向量/BLOB 列打爆上下文）', async () => {
    const h = await makeHarness()
    // 用含超长列的自建库（模拟向量列）
    const file = join(h.dataDir, 'vectors.db')
    {
      const db = new DatabaseSync(file)
      db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, embedding TEXT)')
      const vec = Array.from({ length: 128 }, (_, i) => `${i}.${i % 7}`).join(',')
      const stmt = db.prepare('INSERT INTO products (name, embedding) VALUES (?, ?)')
      stmt.run('短债基金', vec)
      stmt.run('纯债基金', 'short')
      db.close()
    }
    await start(h, makeDbFlow(file))
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'query', sql: 'SELECT id, name, embedding FROM products ORDER BY id LIMIT 10' }, execOf(childAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'query', truncated: true })
    const rows = (result as { rows: string[][] }).rows
    expect(rows[0][1]).toBe('短债基金')
    // 超长向量列被截断（长度 ≤ QUERY_CELL_MAX_LENGTH + 标记）
    expect(rows[0][2].length).toBeLessThanOrEqual(QUERY_CELL_MAX_LENGTH + 1)
    expect(rows[0][2].endsWith('…')).toBe(true)
    // 短值不受影响
    expect(rows[1][2]).toBe('short')
  })

  it('search 模式：请求 topK 超过检索上限且被上限卡住 → truncated 上报；未卡住不误报', async () => {
    const h = await makeHarness()
    const file = join(h.dataDir, 'many-rows.db')
    {
      const db = new DatabaseSync(file)
      db.exec('CREATE TABLE docs (id INTEGER PRIMARY KEY, content TEXT)')
      const stmt = db.prepare('INSERT INTO docs (content) VALUES (?)')
      for (let i = 0; i < SEARCH_TOP_K_MAX + 10; i += 1) stmt.run(`水果 第${i}条 内容`)
      db.close()
    }
    await start(h, makeDbFlow(file))
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    // 请求 100 > 上限 50 且返回条数达到上限 → 上限真的卡住了结果，如实上报
    const clamped = await def.execute({ dataId: 'd1', mode: 'search', query: '水果', topK: 100 }, execOf(childAgent))
    expect(clamped).toMatchObject({ dataId: 'd1', mode: 'search', truncated: true })
    expect((clamped as { hits: unknown[] }).hits).toHaveLength(SEARCH_TOP_K_MAX)
    // 请求在上限内 → 不出现 truncated 字段（沿用 query 模式的「有才报」风格）
    const within = await def.execute({ dataId: 'd1', mode: 'search', query: '水果', topK: 3 }, execOf(childAgent))
    expect((within as { hits: unknown[] }).hits).toHaveLength(3)
    expect((within as { truncated?: boolean }).truncated).toBeUndefined()
  })

  it('schema 模式：表数正好达到上限 → 不误报 truncated（精确口径，与 search 一致）', async () => {
    const h = await makeHarness()
    const file = join(h.dataDir, 'exact-cap.db')
    makeTableDb(file, SCHEMA_TABLE_LIMIT)
    await h.store.saveWorkflow(makeDbFlow(file), 'session-1', { force: true })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, execOf(rootAgent))
    expect((result as { tables: unknown[] }).tables).toHaveLength(SCHEMA_TABLE_LIMIT)
    expect((result as { truncated?: boolean }).truncated).toBeUndefined()
  })

  it('schema 模式：表数超过上限一张 → truncated 上报，且只返回上限数量（大库不灌满上下文）', async () => {
    const h = await makeHarness()
    const file = join(h.dataDir, 'many-tables.db')
    makeTableDb(file, SCHEMA_TABLE_LIMIT + 1)
    await h.store.saveWorkflow(makeDbFlow(file), 'session-1', { force: true })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const result = await def.execute({ dataId: 'd1', mode: 'schema' }, execOf(rootAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'schema', truncated: true })
    expect((result as { tables: unknown[] }).tables).toHaveLength(SCHEMA_TABLE_LIMIT)
  })
})
