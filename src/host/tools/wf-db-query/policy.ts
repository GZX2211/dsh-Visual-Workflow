// src/host/tools/wf-db-query/policy.ts
//
// wf_db_query 的安全策略（纯函数）：SQL 只读白名单。
//
// 安全边界（架构安全章节）：仅单条 SELECT、要求显式 LIMIT、拒绝写/DDL/多语句/文件导出。
// 这是 fail-closed 正则护栏（不做完整 SQL 解析）：用**单趟扫描状态机**区分「注释」与
// 「字符串 / 引用标识符」，判定只在派生文本上做；**返回给执行侧的始终是原始 SQL**。
// 「护栏只判定不改写」是硬前提：任何「校验即改写」的实现都会让实际执行的查询与用户提交的
// 不一致（例如字面量里的 `/*c*/` 被当真注释删掉，等于静默执行另一个查询，D03-02）。
//
// LIMIT 的口径（重要，勿高估本护栏）：这里只做**形式判定**——存在 `LIMIT <数字>` 关键字。
// 它**不构成行数上限**：`LIMIT 999999999` 与完全不写 LIMIT 在内存物化开销上等价。
// 真正的行数上限由执行层给出：驱动按 maxRows 逐行读取、读满即停（见 driver.ts 的 query）。

import type { SqlCheckResult } from './types.js'

/** 扫描到的未闭合结构（判定文本不可信 → fail-closed 拒绝）。 */
type Unterminated = 'literal' | 'identifier' | 'comment' | null

/** 无法安全判定的方言形态（超集 fail-closed：一律拒绝，不做方言建模）。 */
type Unsupported = 'dollar-quote' | 'hash' | null

/** 单趟扫描结果。 */
interface SqlScanResult {
  /** 判定文本：注释 → 空格；引号区 → `''` 占位；其余原样。 */
  text: string
  /** 未闭合结构（非 null 时直接拒绝）。 */
  unterminated: Unterminated
  /** 无法安全判定的方言形态（非 null 时直接拒绝）。 */
  unsupported: Unsupported
}

/**
 * 单趟扫描 SQL，产出「判定文本」：注释与字符串/引用标识符的内容一律抹去
 * （注释→空格；引号区→`''` 占位，避免两侧 token 粘连），其余字符原样保留。
 *
 * 为什么要扫描而不是正则：正则无法在一次替换里区分「注释里的引号」与「引号里的注释」。
 * 先删注释会把字面量里的 `--` / `/*` 一并吃掉（D03-02 的根因）；先删字面量则会把
 * 注释里的引号当字面量。两者都必须由同一趟状态机同时判定。
 *
 * 引号区支持 SQL 标准的**双写转义**（`''` / `""` / `` `` ``）；三种引号分别按
 * 字符串字面量（`'`）与引用标识符（`"` / 反引号）处理——两者对判定文本的效果相同
 * （内容都不是语句关键字），区别只在错误文案。
 *
 * 方言形态：**超集 fail-closed（不做方言建模）**。
 * 逐方言精确建模引号/注释是不收敛的：每补一个方言就可能给另一个方言开洞
 * （先修 PG `$$` 引号 → 又出 PG `#` 位运算符；见 B4-F1 / B4-F2 两轮复审）。
 * 因此改为「任何可能隐藏语句边界的方言形态一律拒绝」，既不依赖方言判断、也不会放行：
 *   - PG 美元引号 `$$…$$` / `$tag$…$tag$` → 拒绝（`unsupported: 'dollar-quote'`）；
 *   - 裸 `#`（在字符串/标识符之外）→ 拒绝（MySQL 视其为行注释、PG 视其为位运算符，
 *     同一字符两种语义，无法在不区分方言的前提下安全判定）。
 * 代价是极少数合法查询（PG 的 `$$` 函数体、MySQL 的 `#` 注释）被拒——fail-closed 取舍。
 * 注：`$1` 这类位置参数不含闭合 `$`，不属美元引号，仍按普通字符处理。
 */
function scanForEvaluation(input: string): SqlScanResult {
  let text = ''
  let index = 0
  const length = input.length
  while (index < length) {
    const char = input[index]
    const next = index + 1 < length ? input[index + 1] : ''
    // 行注释：吃到行尾（换行保留，维持行结构）
    if (char === '-' && next === '-') {
      while (index < length && input[index] !== '\n') index += 1
      text += ' '
      continue
    }
    // 裸 `#`：一律拒绝（不判定方言；理由见上方「方言形态」注释）
    if (char === '#') return { text, unterminated: null, unsupported: 'hash' }
    // 块注释：吃到 */（未闭合 → 判定文本不可信）
    if (char === '/' && next === '*') {
      index += 2
      let closed = false
      while (index < length) {
        if (input[index] === '*' && input[index + 1] === '/') {
          index += 2
          closed = true
          break
        }
        index += 1
      }
      if (!closed) return { text, unterminated: 'comment', unsupported: null }
      text += ' '
      continue
    }
    // 字符串字面量（'）与引用标识符（" / `）
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      index += 1
      let closed = false
      while (index < length) {
        if (input[index] === quote) {
          if (input[index + 1] === quote) {
            index += 2
            continue
          }
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) return { text, unterminated: quote === "'" ? 'literal' : 'identifier', unsupported: null }
      text += "''"
      continue
    }
    // 美元引号（$$…$$ / $tag$…$tag$）：一律拒绝——不再尝试按 PG 语义抹去内容，
    // 因为「精确建模」会让其它方言出现新洞（B4-F1 修好 $$ 后 B4-F2 又出 `#`）。
    if (char === '$' && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(input.slice(index))) {
      return { text, unterminated: null, unsupported: 'dollar-quote' }
    }
    text += char
    index += 1
  }
  return { text, unterminated: null, unsupported: null }
}

/** 未闭合结构的可行动错误文案。 */
function unterminatedError(kind: Exclude<Unterminated, null>): string {
  if (kind === 'literal') return 'unterminated string literal: the SQL cannot be evaluated safely'
  if (kind === 'identifier') return 'unterminated quoted identifier: the SQL cannot be evaluated safely'
  return 'unterminated block comment: the SQL cannot be evaluated safely'
}

/** 无法安全判定的方言形态的可行动错误文案（说明「是什么」且给出出路）。 */
function unsupportedError(kind: Exclude<Unsupported, null>): string {
  if (kind === 'dollar-quote') {
    return 'unsupported dialect syntax: dollar-quoted strings ($$...$$ or $tag$...$tag$) cannot be checked safely; rewrite the query without them'
  }
  return 'unsupported dialect syntax: "#" starts a line comment in MySQL but is a bitwise operator in PostgreSQL, so it cannot be checked safely; rewrite the query without it'
}

/**
 * 只读 SQL 白名单校验：
 *   - 单趟扫描产出判定文本（注释与字面量内容抹去）；未闭合引号/注释直接拒绝；
 *   - 无法安全判定的方言形态（`$$`/`$tag$`/裸 `#`）直接拒绝（超集 fail-closed）；
 *   - 判定文本为空 → 拒绝；
 *   - 多语句拒绝（判定文本去掉一个尾分号后仍含分号）；
 *   - 首关键字必须 SELECT；
 *   - 写/DDL 关键字黑名单（词边界）拒绝；
 *   - 文件导出（INTO OUTFILE/DUMPFILE）拒绝；
 *   - 必须携带 `LIMIT <数字>`（**形式约束**，不是行数上限，见文件头）。
 *
 * ok 时返回的 `sql` 是**入参原文**（逐字相等）：判定与执行使用同一份文本，护栏不改写。
 */
export function sanitizeReadOnlySql(raw: string): SqlCheckResult {
  const input = String(raw ?? '').trim()
  if (!input) return { ok: false, error: 'SQL must not be empty' }
  const scan = scanForEvaluation(input)
  if (scan.unsupported !== null) return { ok: false, error: unsupportedError(scan.unsupported) }
  if (scan.unterminated !== null) return { ok: false, error: unterminatedError(scan.unterminated) }
  // 判定文本：注释与字面量内容已被抹去；空（例如整条都是注释）视为无有效 SQL。
  const evaluated = scan.text.trim()
  if (!evaluated) return { ok: false, error: 'SQL must not be empty' }
  // 去掉一个尾分号后判定多语句：`SELECT 1;` 合法，`SELECT 1; SELECT 2` 非法。
  // 注意：这里只影响判定，返回给执行侧的仍是含尾分号的原文。
  const single = evaluated.replace(/;\s*$/, '')
  if (single.includes(';')) return { ok: false, error: 'only a single statement is allowed (multiple statements are rejected)' }
  if (!/^select\b/i.test(single)) return { ok: false, error: 'only read-only SELECT queries are allowed' }
  const blocked = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|attach|detach|vacuum|pragma|reindex|replace|execute)\b/i
  if (blocked.test(single)) return { ok: false, error: 'it contains a blocked write/DDL keyword' }
  if (/\binto\s+(outfile|dumpfile)\b/i.test(single)) return { ok: false, error: 'file export (INTO OUTFILE/DUMPFILE) is not allowed' }
  // LIMIT 判定同样只看判定文本：字面量/注释里的 "limit 5" 不构成 LIMIT（D03-01）。
  if (!/\blimit\s+\d+/i.test(single)) return { ok: false, error: 'SELECT must carry a numeric LIMIT (a form check only; the engine is not row-capped by this guard)' }
  return { ok: true, sql: input }
}
