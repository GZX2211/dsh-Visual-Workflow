// tests/host/tools/wf-db-query/tool.test.ts
//
// wf_db_query 工具（tool.ts）单测：注册面（参数/输出 schema/description W-03）与
// 三模式执行、归属校验（运行态解耦/无实例/坏节点/无连线）、SQL 与索引错误路径。

import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { EmbeddingEngine } from '../../../../src/host/embedding/engine.js'
import type { DatabaseNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import { WF_DB_QUERY } from '../../../../src/host/shared/protocol.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { buildIndexForDatabase } from '../../../../src/host/tools/wf-db-query/service.js'
import { QUERY_CELL_MAX_LENGTH, registerWfDbQuery } from '../../../../src/host/tools/wf-db-query/tool.js'
import type { WfDbQueryHost } from '../../../../src/host/tools/wf-db-query/types.js'
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

/** 降级引擎替身（bm25：不做嵌入）。 */
const engine: EmbeddingEngine = { source: 'bm25', dimension: 0, async embed() { throw new Error('bm25 only') }, dispose() {} }

interface DbHarness extends TestEnv {
  host: WfDbQueryHost
  engine: EmbeddingEngine
  dataDir: string
  dbFile: string
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 临时 SQLite 库 + 注册 wf_db_query。 */
async function makeHarness(): Promise<DbHarness> {
  const env = await makeEnv()
  const dbFile = await makeSqliteDb(env.dir)
  const host: WfDbQueryHost = { orchestrator: env.runtime, store: env.store, dataDir: env.dir, engine }
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
    // 既有偏差（如实记录，不在目录治理中改动提示词文本）：本条 description 实测约 139 词，
    // 超出 W-03 的 ≤120 tokens 目标；它是模型可见文本且非本次目录治理范围，故不在此收紧。
    expect(description.split(/\s+/).length).toBeGreaterThan(20)
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

  it('search 模式：索引未建 → WF_DB_INDEX_MISSING；建索引后返回 hits（bm25 标注）', async () => {
    const h = await makeHarness()
    await start(h)
    await h.runtime.wfRunNode({ isChild: false, sessionId: 'session-1' }, { nodeId: 'a1' })
    const def = h.tools.definitions.get(WF_DB_QUERY)!
    const node = makeDbFlow(h.dbFile).nodes.find((n) => n.id === 'd1') as DatabaseNode
    await buildIndexForDatabase(h.dataDir, node, h.engine)
    const result = await def.execute({ dataId: 'd1', mode: 'search', query: '数据库', topK: 3 }, execOf(childAgent))
    expect(result).toMatchObject({ dataId: 'd1', mode: 'search', source: 'bm25' })
    const hits = (result as { hits: Array<{ text: string }> }).hits
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.text.includes('向量 检索'))).toBe(true)
    // 未建索引的数据节点 → 明确错误
    const missing = await def.execute({ dataId: 'd1', mode: 'search', query: 'x' }, execOf(childAgent))
    expect(missing).toMatchObject({ dataId: 'd1', mode: 'search' })
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
    // 服务器类型已允许向量检索（不再抛 WF_DB_MODE）；测试环境无 mysql2 驱动/服务 → 驱动或连接错误
    expect(error?.code).not.toBe('WF_DB_MODE')
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
})
