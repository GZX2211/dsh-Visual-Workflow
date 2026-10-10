// src/host/tools/wf-db-query/policy.ts
//
// wf_db_query 的安全策略（纯函数）：SQL 只读白名单。
//
// 安全边界（架构安全章节）：仅单条 SELECT、强制 LIMIT、拒绝写/DDL/多语句/文件导出。
// 这是 fail-closed 正则护栏（不做完整 SQL 解析），因此先剥离注释与字符串字面量以消除误伤，
// 再逐条判定；任何不确定形态一律拒绝。
/**
 * 只读 SQL 白名单校验：
 *   - 剥离注释（行注释与块注释）后 trim；空 → 拒绝；
 *   - 多语句拒绝（去除尾部单分号后仍含分号）；
 *   - 首关键字必须 SELECT；
 *   - 写/DDL 关键字黑名单（词边界）拒绝；
 *   - 文件导出（INTO OUTFILE/DUMPFILE）拒绝；
 *   - 必须携带 LIMIT 数字（强制行数上限，防全表拉取）。
 */
export function sanitizeReadOnlySql(raw) {
    const input = String(raw ?? '').trim();
    if (!input)
        return { ok: false, error: 'SQL must not be empty' };
    const stripped = input
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .trim();
    if (!stripped)
        return { ok: false, error: 'SQL must not be empty' };
    const single = stripped.replace(/;\s*$/, '');
    // 先剥离字符串字面量再检查多语句：`SELECT 'a;b' AS x` 中字面量内的分号不是
    // 语句分隔符（护栏是 fail-closed 正则、不做完整 SQL 解析；与下方黑名单同样
    // 先剥离字面量消除误伤）。剥离后 `SELECT 1; SELECT 2` 的分号仍在 → 拒绝。
    const literalFree = single.replace(/'(?:[^']|'')*'/g, "''");
    if (literalFree.includes(';'))
        return { ok: false, error: 'only a single statement is allowed (multiple statements are rejected)' };
    if (!/^select\b/i.test(single))
        return { ok: false, error: 'only read-only SELECT queries are allowed' };
    const blocked = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|attach|detach|vacuum|pragma|reindex|replace|execute)\b/i;
    if (blocked.test(literalFree))
        return { ok: false, error: 'it contains a blocked write/DDL keyword' };
    if (/\binto\s+(outfile|dumpfile)\b/i.test(literalFree))
        return { ok: false, error: 'file export (INTO OUTFILE/DUMPFILE) is not allowed' };
    if (!/\blimit\s+\d+/i.test(single))
        return { ok: false, error: 'SELECT must carry a numeric LIMIT' };
    return { ok: true, sql: single };
}
//# sourceMappingURL=policy.js.map