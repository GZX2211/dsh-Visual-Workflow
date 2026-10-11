import type { SqlCheckResult } from './types.js';
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
export declare function sanitizeReadOnlySql(raw: string): SqlCheckResult;
