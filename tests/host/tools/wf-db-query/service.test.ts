// tests/host/tools/wf-db-query/service.test.ts
//
// 索引构建（service.ts）单测：本地库全表文本化索引、vectorOptions 采纳与 rowKey、
// 向量列识别纯函数、标识符引用、行主键识别、运行期预建（ensureDatabaseIndexes）复用语义。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { VectorIndex } from '../../../../src/host/embedding/indexer.js'
import type { EmbeddingEngine } from '../../../../src/host/embedding/engine.js'
import type { DatabaseNode } from '../../../../src/host/shared/graph-model.js'
import {
  buildIndexForDatabase,
  detectKeyIndex,
  ensureDatabaseIndexes,
  indexPathOf,
  isVectorLikeValue,
  quoteDbIdentifier,
  skipVectorColumns,
} from '../../../../src/host/tools/wf-db-query/service.js'
import { makeDbFlow, makeSqliteDb } from '../fixtures/db-fixture.js'
import { cleanupTempDirs, tempDir } from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

/** 降级引擎替身（bm25：不做嵌入）。 */
function bm25Engine(): EmbeddingEngine {
  return { source: 'bm25', dimension: 0, async embed() { throw new Error('bm25 only') }, dispose() {} }
}

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
    const { file: indexFile, truncated } = await buildIndexForDatabase(dir, node, bm25Engine())
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

  it('ensureDatabaseIndexes：为 db-in 所连本地库预建索引；已存在则复用不重复重建', async () => {
    const dir = await tempDir('vw-idx-')
    const dbFile = await makeSqliteDb(dir)
    const engine = bm25Engine()
    const flow = makeDbFlow(dbFile)
    const warn = vi.fn()
    // 首次：无索引 → 预建
    await ensureDatabaseIndexes(dir, 'a1', flow, engine, { warn })
    const index = new VectorIndex(indexPathOf(dir, 'd1'))
    const file = await index.load()
    expect(file).not.toBeNull()
    expect(file!.chunks.length).toBeGreaterThan(0)
    // 再次：已有索引 → 复用（chunks 数量不变，未触发重建）
    const before = file!.chunks.length
    await ensureDatabaseIndexes(dir, 'a1', flow, engine, { warn })
    const file2 = await index.load()
    expect(file2!.chunks.length).toBe(before)
    // 无 db-in 连线的节点：不构建任何索引、不再额外触发 warn
    const warnCount = warn.mock.calls.length
    await ensureDatabaseIndexes(dir, 'a2', flow, engine, { warn })
    expect(warn.mock.calls.length).toBe(warnCount)
  })
})

describe('索引文本构建的纯函数', () => {
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
    const rows = [['1', '短债基金', Array.from({ length: 16 }, () => '0.1').join(',')]]
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

  it('indexPathOf：dataId 消毒后落到 <dataDir>/data/vector', () => {
    expect(indexPathOf(join('root'), 'd/1:x')).toBe(join('root', 'data', 'vector', 'd_1_x.json'))
  })
})
