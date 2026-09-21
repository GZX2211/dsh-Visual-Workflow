// tests/host/tools/wf-db-query/policy.test.ts
//
// SQL 只读白名单（policy.ts）单测：接受/拒绝矩阵、强制 LIMIT、多语句、写/DDL 黑名单、
// 字面量与列名边界（词边界不误伤）。

import { describe, expect, it } from 'vitest'
import { sanitizeReadOnlySql } from '../../../../src/host/tools/wf-db-query/policy.js'

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
