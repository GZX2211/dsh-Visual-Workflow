// tests/host/tools/wf-db-query/driver.test.ts
//
// 数据库驱动（driver.ts）单测：SqliteDriver 只读访问与物理防写、
// createDatabaseDriver 配置错误路径、连接测试成功/失败。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DatabaseNode } from '../../../../src/host/shared/graph-model.js'
import {
  SCHEMA_TABLE_LIMIT,
  SqliteDriver,
  createDatabaseDriver,
  schemaQuery,
  testDatabaseConnection,
} from '../../../../src/host/tools/wf-db-query/driver.js'
import { makeSqliteDb } from '../fixtures/db-fixture.js'
import { cleanupTempDirs, tempDir } from '../fixtures/tool-harness.js'

/**
 * `mysql2` 是否已安装。
 * 为什么用 `require.resolve` 而不是动态 `import()`：本文件的用例会用 `vi.doMock('mysql2/promise')`
 * 模拟驱动缺失，动态 import 会被 mock 影响；`require.resolve` 走真实解析，不受 mock 干扰。
 * 为什么静态判定：`it.skipIf` 的条件在用例收集期求值，必须在注册前拿到确定结论。
 */
const MYSQL2_AVAILABLE = ((): boolean => {
  try {
    createRequire(import.meta.url).resolve('mysql2/promise')
    return true
  } catch {
    return false
  }
})()

afterEach(async () => {
  // 模块 mock 只在本文件内生效，用后立即解除，避免污染同进程内其他用例
  vi.doUnmock('mysql2/promise')
  vi.resetModules()
  await cleanupTempDirs()
})

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

  it('文件不存在 → 连接测试报明确错误（不可打开，而非其他失败）', async () => {
    const dir = await tempDir('vw-drv-')
    const driver = new SqliteDriver(join(dir, 'missing.db'))
    try {
      // 真实错误语义：node:sqlite 对缺失文件报「无法打开数据库文件」，
      // macOS/Linux 上不退化为其他失败；断言语义而非「抛了就行」
      await expect(driver.testConnection()).rejects.toThrow(/unable to open database file|SQLITE_CANTOPEN/i)
    } finally {
      driver.close()
    }
  })

  it('schema 查询语句：三通道共用同一上限本体（探测取上限+1 行，契约为 200）', () => {
    expect(SCHEMA_TABLE_LIMIT).toBe(200)
    for (const kind of ['sqlite', 'mysql', 'postgresql'] as const) {
      expect(schemaQuery(kind).endsWith(`LIMIT ${SCHEMA_TABLE_LIMIT + 1}`), kind).toBe(true)
    }
  })

  it('schema：表数超过上限时只返回上限数量（大库表名列表不灌满上下文）', async () => {
    const dir = await tempDir('vw-drv-')
    const file = join(dir, 'many-tables.db')
    makeTableDb(file, SCHEMA_TABLE_LIMIT + 5)
    const driver = new SqliteDriver(file)
    try {
      const tables = await driver.schema()
      expect(tables).toHaveLength(SCHEMA_TABLE_LIMIT)
    } finally {
      driver.close()
    }
  })

  it('schemaPage 精确口径：正好上限张 → truncated=false（不把「正好满」误报为截断）', async () => {
    const dir = await tempDir('vw-drv-')
    const file = join(dir, 'exact-cap.db')
    makeTableDb(file, SCHEMA_TABLE_LIMIT)
    const driver = new SqliteDriver(file)
    try {
      const page = await driver.schemaPage()
      expect(page.tables).toHaveLength(SCHEMA_TABLE_LIMIT)
      expect(page.truncated).toBe(false)
    } finally {
      driver.close()
    }
  })

  it('schemaPage 精确口径：超过上限一张 → truncated=true 且清单截到上限', async () => {
    const dir = await tempDir('vw-drv-')
    const file = join(dir, 'over-cap.db')
    makeTableDb(file, SCHEMA_TABLE_LIMIT + 1)
    const driver = new SqliteDriver(file)
    try {
      const page = await driver.schemaPage()
      expect(page.tables).toHaveLength(SCHEMA_TABLE_LIMIT)
      expect(page.truncated).toBe(true)
    } finally {
      driver.close()
    }
  })
})

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
    expect(() => createDatabaseDriver(dbNode())).toThrow('WF_DB_CONFIG')
  })

  it('服务器无连接信息 → 配置错误', () => {
    expect(() => createDatabaseDriver(dbNode({ dbType: 'server', dbKind: 'mysql' }))).toThrow('WF_DB_CONFIG')
  })

  it('本地库连接测试成功/文件缺失失败', async () => {
    const dir = await tempDir('vw-drv-')
    const file = await makeSqliteDb(dir)
    expect(await testDatabaseConnection(dbNode({ localPath: file }))).toEqual({ ok: true, message: '连接成功' })
    const failed = await testDatabaseConnection(dbNode({ localPath: join(dir, 'nope.db') }))
    expect(failed.ok).toBe(false)
    expect(failed.message).toContain('连接失败')
  })

  // 驱动是 optionalDependencies：未安装时「连接失败」用例覆盖的会是 WF_DB_DRIVER_MISSING 分支，
  // 与真实连接回归不可区分。故用显式可见跳过代替硬失败——环境缺失在测试输出里表现为 skipped，
  // 真实缺陷仍表现为 failed；驱动可用时本用例照常执行真实 TCP 连接（跳过不掩盖真实路径）。
  it.skipIf(!MYSQL2_AVAILABLE)('服务器连接：未监听端口 → 连接失败（错误语义为拒绝连接）', async () => {
    const node = dbNode({
      dbType: 'server',
      dbKind: 'mysql',
      conn: { host: '127.0.0.1', port: 1, user: 'u', password: 'p', db: 'd' },
    })
    const result = await testDatabaseConnection(node)
    expect(result.ok).toBe(false)
    // 区分「连接被拒」与「驱动缺失」：只有前者才是本用例要锁的语义
    expect(result.message).toMatch(/ECONNREFUSED|ECONNRESET|ETIMEDOUT/)
    expect(result.message).not.toContain('WF_DB_DRIVER_MISSING')
  }, 15000)

  it('MySQL 驱动缺失 → WF_DB_DRIVER_MISSING（可行动的安装提示）', async () => {
    // 与是否安装 mysql2 无关：doMock 让惰性 import() 必然失败，因此在有无驱动的环境下语义一致
    vi.doMock('mysql2/promise', () => {
      throw new Error('Cannot find package mysql2')
    })
    const node = dbNode({
      dbType: 'server',
      dbKind: 'mysql',
      conn: { host: '127.0.0.1', port: 1, user: 'u', password: 'p', db: 'd' },
    })
    const driver = createDatabaseDriver(node)
    await expect(driver.query('SELECT 1')).rejects.toMatchObject({
      code: 'WF_DB_DRIVER_MISSING',
      message: expect.stringContaining('install mysql2') as unknown as string,
    })
  }, 15000)
})
