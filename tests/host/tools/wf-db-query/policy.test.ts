// tests/host/tools/wf-db-query/policy.test.ts
//
// SQL 只读白名单（policy.ts）单测：接受/拒绝矩阵、强制 LIMIT、多语句、写/DDL 黑名单、
// 字面量与列名边界（词边界不误伤）。

import { describe, expect, it } from 'vitest'
import { sanitizeReadOnlySql } from '../../../../src/host/tools/wf-db-query/policy.js'

describe('sanitizeReadOnlySql 白名单', () => {
  it('接受：单条 SELECT + LIMIT（大小写不敏感、尾分号原样保留）', () => {
    expect(sanitizeReadOnlySql('SELECT * FROM t LIMIT 10')).toEqual({ ok: true, sql: 'SELECT * FROM t LIMIT 10' })
    // 护栏只判定不改写（D03-02）：尾分号属于原始 SQL 的一部分，必须原样返回给执行侧
    expect(sanitizeReadOnlySql('select name from t where id = 1 limit 5;')).toEqual({ ok: true, sql: 'select name from t where id = 1 limit 5;' })
    expect(sanitizeReadOnlySql('SELECT a FROM t -- 注释\nLIMIT 3')).toMatchObject({ ok: true })
    expect(sanitizeReadOnlySql('SELECT a /* 块注释 */ FROM t LIMIT 3')).toMatchObject({ ok: true })
  })

  it('接受：带注释的 SQL 原样返回（注释不被剥离后再执行）', () => {
    const sql = 'SELECT a /* 块注释 */ FROM t LIMIT 3'
    expect(sanitizeReadOnlySql(sql)).toEqual({ ok: true, sql })
    const lineComment = 'SELECT a FROM t -- 注释\nLIMIT 3'
    expect(sanitizeReadOnlySql(lineComment)).toEqual({ ok: true, sql: lineComment })
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
// D03-02：护栏只判定、不改写（ok:true 时 sql 必须与入参逐字相等）
// ---------------------------------------------------------------------------

describe('sanitizeReadOnlySql 不改写被执行的 SQL（D03-02）', () => {
  it('字面量内含块注释标记：不被剥离，原样返回（旧实现会执行成另一个查询）', () => {
    const sql = "SELECT '/*c*/' AS v FROM t LIMIT 1"
    expect(sanitizeReadOnlySql(sql)).toEqual({ ok: true, sql })
  })

  it('字面量内含行注释标记：不被剥离，原样返回', () => {
    const sql = "SELECT 'a--b' AS v FROM t LIMIT 1"
    expect(sanitizeReadOnlySql(sql)).toEqual({ ok: true, sql })
  })

  it('字面量内含分号与引号：内容不被改写（含转义双写引号）', () => {
    const sql = "SELECT 'it''s;ok' AS v FROM t LIMIT 1"
    expect(sanitizeReadOnlySql(sql)).toEqual({ ok: true, sql })
  })

  it('未闭合的单引号：判定文本不可信 → fail-closed 拒绝（并说明原因）', () => {
    const result = sanitizeReadOnlySql("SELECT 'a FROM t LIMIT 1")
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/unterminated|unclosed/i)
  })

  it('未闭合的块注释：同样 fail-closed 拒绝', () => {
    const result = sanitizeReadOnlySql('SELECT a FROM t /* 未闭合 LIMIT 1')
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D03-01：LIMIT 判定必须基于「去字面量」文本（形式约束，不是行数上限）
// ---------------------------------------------------------------------------

describe('sanitizeReadOnlySql 的 LIMIT 判定口径（D03-01）', () => {
  it('字面量里出现 limit 5 不构成 LIMIT：无 LIMIT 的查询仍被拒绝', () => {
    expect(sanitizeReadOnlySql("SELECT 'limit 5' AS v FROM t")).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT name FROM t WHERE note = \'limit 999\'')).toMatchObject({ ok: false })
  })

  it('注释里出现 limit 5 不构成 LIMIT（注释已先被剥离）', () => {
    expect(sanitizeReadOnlySql('SELECT a FROM t /* limit 5 */')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT a FROM t -- limit 5')).toMatchObject({ ok: false })
  })

  it('真实 LIMIT 仍被接受（含大小写与多空格形态）', () => {
    expect(sanitizeReadOnlySql('SELECT a FROM t LIMIT 5')).toMatchObject({ ok: true })
    expect(sanitizeReadOnlySql('SELECT a FROM t limit    5')).toMatchObject({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// 复审修正 B4-F1 + B4-F2：方言形态一律拒绝（超集 fail-closed）
//
// 为什么不再「按方言友好解析」：逐方言精确建模每补一个方言就可能给另一个方言开洞
// （`$$` 修好后 `#` 又成新洞）。改为「任何可能隐藏语句边界的方言形态一律拒绝」：
// 既不依赖方言判断、也不会放行；代价是极少数合法查询被拒（fail-closed 取舍）。
// ---------------------------------------------------------------------------

describe('sanitizeReadOnlySql 拒绝无法安全判定的方言形态（B4-F1 / B4-F2）', () => {
  it('PG `#` 位运算符形态：一律拒绝（不得当注释吞掉语句边界）', () => {
    // 复审 B4-F2 的实据形态：PG 中 `#` 是位运算符，若当注释处理则 `; DROP TABLE t` 被吞 → 放行
    expect(sanitizeReadOnlySql('SELECT 1 LIMIT 1 # 2 ; DROP TABLE t')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT a FROM t # LIMIT 5')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT 1 LIMIT 1 # DROP TABLE t')).toMatchObject({ ok: false })
  })

  it('PG 美元引号 `$$…$$`：一律拒绝（含分隔符被吞的绕过形态）', () => {
    expect(sanitizeReadOnlySql('SELECT $$a;b$$ AS v FROM t LIMIT 1')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql("SELECT $$a'$$ ; DROP TABLE t -- ' LIMIT 1")).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT $$abc FROM t LIMIT 1')).toMatchObject({ ok: false })
  })

  it('PG 美元引号 `$tag$…$tag$`：一律拒绝（未闭合同样拒绝）', () => {
    expect(sanitizeReadOnlySql('SELECT $tag$a;b$tag$ AS v FROM t LIMIT 1')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT $tag$x$tag$ ; DROP TABLE t LIMIT 1')).toMatchObject({ ok: false })
    expect(sanitizeReadOnlySql('SELECT $tag$abc FROM t LIMIT 1')).toMatchObject({ ok: false })
  })

  it('拒绝理由可行动（明确指向方言语法，而不是笼统的「非法」）', () => {
    const hash = sanitizeReadOnlySql('SELECT 1 LIMIT 1 # x')
    const dollar = sanitizeReadOnlySql('SELECT $$a$$ LIMIT 1')
    expect(hash.ok === false && hash.error).toMatch(/dialect|#/i)
    expect(dollar.ok === false && dollar.error).toMatch(/dialect|\$/i)
  })

  it('不误伤：引号内的 `#` / `$$`、以及 `$1` 位置参数仍被接受', () => {
    expect(sanitizeReadOnlySql("SELECT '#x' AS v FROM t LIMIT 1")).toEqual({ ok: true, sql: "SELECT '#x' AS v FROM t LIMIT 1" })
    expect(sanitizeReadOnlySql("SELECT '$$a' AS v FROM t LIMIT 1")).toEqual({ ok: true, sql: "SELECT '$$a' AS v FROM t LIMIT 1" })
    expect(sanitizeReadOnlySql('SELECT "a#b" FROM t LIMIT 1')).toEqual({ ok: true, sql: 'SELECT "a#b" FROM t LIMIT 1' })
    // `$1` 不是美元引号（无闭合 `$`）→ 按普通字符处理
    expect(sanitizeReadOnlySql('SELECT a FROM t WHERE b = $1 LIMIT 1')).toEqual({ ok: true, sql: 'SELECT a FROM t WHERE b = $1 LIMIT 1' })
  })
})
