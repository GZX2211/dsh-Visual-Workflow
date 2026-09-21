// tests/host/tools/wf-db-query/driver.test.ts
//
// 数据库驱动（driver.ts）单测：SqliteDriver 只读访问与物理防写、
// createDatabaseDriver 配置错误路径、连接测试成功/失败。

import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { DatabaseNode } from '../../../../src/host/shared/graph-model.js'
import {
  SqliteDriver,
  createDatabaseDriver,
  testDatabaseConnection,
} from '../../../../src/host/tools/wf-db-query/driver.js'
import { makeSqliteDb } from '../fixtures/db-fixture.js'
import { cleanupTempDirs, tempDir } from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

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
