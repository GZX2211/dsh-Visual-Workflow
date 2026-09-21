// src/host/tools/wf-db-query/service.ts
//
// 数据库节点的本地向量/B25 索引构建与预建（gui 数据库面板与运行期共用）。
//
// 需求语义：本地 SQLite 与服务器 MySQL/PostgreSQL 共用同一套本地索引基础设施
// （一致性；服务器只需提供只读查询能力）。数据库内容绝不直接注入上下文，
// 仅经工具查询结果返回；索引文本构建跳过向量/嵌入列（对语义检索无意义且膨胀体积）。
import { join } from 'node:path';
import { dbInEdges, nodeById } from '../../graph/model.js';
import { VectorIndex } from '../../embedding/indexer.js';
import { CHUNK_OVERLAP_DEFAULT, CHUNK_SIZE_DEFAULT } from '../../embedding/chunker.js';
import { createDatabaseDriver } from './driver.js';
/** 索引构建行数上限（防超大库打爆内存；超限截断并返回截断标记）。 */
export const INDEX_MAX_ROWS = 10000;
/**
 * 判定单元格是否为「向量/嵌入」型值：逗号分隔的浮点数组（≥16 个 token 且 ≥90% 为 float）。
 * 用于索引文本构建排除向量列与 query 结果保护。纯函数。
 */
export function isVectorLikeValue(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed)
        return false;
    // 兼容 pgvector（'[0.1,0.2,…]'）、MySQL、以及常见括号包裹形态
    const inner = trimmed.replace(/^[[{(]/, '').replace(/[\])}]$/, '');
    const tokens = inner
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
    if (tokens.length < 16)
        return false;
    const floatRe = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;
    const floats = tokens.filter((token) => floatRe.test(token)).length;
    return floats / tokens.length >= 0.9;
}
/**
 * 识别需排除的「向量/嵌入」列（供索引文本构建跳过）：列名启发式 + 首行值形态双重判定。
 * 向量列对语义检索文本无意义，且会大幅膨胀索引体积。纯函数。
 */
export function skipVectorColumns(columns, rows) {
    const nameRe = /(?:^|[_\\-])(embedding|embed|vector|vec)\b/i;
    const out = new Set();
    for (let ci = 0; ci < columns.length; ci += 1) {
        const col = columns[ci] ?? '';
        const nameHit = nameRe.test(col);
        const valueHit = rows.length > 0 && isVectorLikeValue(rows[0][ci] ?? '');
        if (nameHit || valueHit)
            out.add(col);
    }
    return out;
}
/**
 * 识别适用于做「行主键」的列下标（供命中回传 rowKey）：优先精确主键名（id/pk/uuid/key/编号/code），
 * 其次任意含 id/key/code/no 的列名；找不到返回 -1。纯函数。
 */
export function detectKeyIndex(columns) {
    const normalized = columns.map((c) => String(c ?? '').trim().toLowerCase());
    for (const exact of ['id', 'pk', 'uuid', 'key', '编号', 'code']) {
        const i = normalized.indexOf(exact);
        if (i >= 0)
            return i;
    }
    for (const [i, name] of normalized.entries()) {
        if (/(?:^|_)(id|key|code|no)(?:_|$)/.test(name))
            return i;
    }
    return -1;
}
/**
 * 按数据库类型生成标识符引用：SQLite/PostgreSQL 用双引号，MySQL 用反引号（转义内嵌引号）。
 * 索引构建对表名做自动引用，避免服务器库（尤其 MySQL）对 `FROM "table"` 的语法误判。
 */
export function quoteDbIdentifier(node, name) {
    const kind = node.data?.dbKind;
    const quote = kind === 'mysql' ? '`' : '"';
    const escaped = String(name).replace(new RegExp(quote, 'g'), `${quote}${quote}`);
    return `${quote}${escaped}${quote}`;
}
/**
 * 为数据库节点（本地 SQLite / 服务器 MySQL-PostgreSQL）构建向量索引：
 * 全表全行文本化（列值 join；跳过向量/嵌入列）后按行分块，原子持久化到
 * <dataDir>/data/vector/<dataId>.json。嵌入可用时写入向量，否则自动落 BM25 索引。
 * 本地与服务器共用同一套本地索引基础设施（一致性；服务器只需提供只读查询能力）。
 */
export async function buildIndexForDatabase(dataDir, node, engine) {
    const driver = createDatabaseDriver(node);
    // 高级选项（均有默认值）：分块窗口 / 重叠 / 行数上限（0 合法、NaN 回退默认）
    const opts = node.data?.vectorOptions ?? {};
    const chunkSizeRaw = Number(opts.chunkSize);
    const chunkSize = Math.max(1, Math.floor(Number.isFinite(chunkSizeRaw) ? chunkSizeRaw : CHUNK_SIZE_DEFAULT));
    const overlapRaw = Number(opts.overlap);
    const overlap = Math.max(0, Math.floor(Number.isFinite(overlapRaw) ? overlapRaw : CHUNK_OVERLAP_DEFAULT));
    const maxRowsRaw = Number(opts.maxRows);
    const maxRows = Math.max(1, Math.floor(Number.isFinite(maxRowsRaw) && maxRowsRaw > 0 ? maxRowsRaw : INDEX_MAX_ROWS));
    let truncated = false;
    try {
        const tables = await driver.schema();
        const records = [];
        for (const table of tables) {
            if (records.length >= maxRows) {
                truncated = true;
                break;
            }
            const tableRef = quoteDbIdentifier(node, table.name);
            const result = await driver.query(`SELECT * FROM ${tableRef} LIMIT ${maxRows - records.length}`);
            const columns = result.columns;
            const skip = skipVectorColumns(columns, result.rows);
            const keyIndex = detectKeyIndex(columns);
            for (const row of result.rows) {
                const rowKey = keyIndex >= 0 ? row[keyIndex] : undefined;
                records.push({
                    text: row
                        .map((value, index) => ({ key: columns[index], value }))
                        .filter((cell) => cell.key !== undefined && !skip.has(cell.key))
                        .map((cell) => `${cell.key}: ${cell.value}`)
                        .join('\n'),
                    source: table.name,
                    ...(rowKey !== undefined && rowKey !== '' ? { rowKey } : {}),
                });
            }
        }
        const index = new VectorIndex(indexPathOf(dataDir, node.id));
        const file = await index.rebuild({
            dataId: node.id,
            records,
            engine,
            chunkSize,
            overlap,
        });
        return { file, truncated };
    }
    finally {
        driver.close();
    }
}
/** 索引文件路径（安全文件名：dataId 消毒）。 */
export function indexPathOf(dataDir, dataId) {
    const safe = String(dataId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    return join(dataDir, 'data', 'vector', `${safe}.json`);
}
/**
 * 为某角色节点的 db-in 所连数据库「确保索引已建立」。
 * - 已存在且非空 → 复用（不重复重建，避免多节点共享同一库时反复全量嵌入）；
 * - 缺失/为空 → 构建（本地与服务器库均可；嵌入不可用时自动落 BM25）；
 * - 单库构建失败 → best-effort 记 warn 不抛错，交由 wf_db_query(mode=search) 惰性构建兜底。
 * 运行期在启动节点子代理之前调用，把索引构建耗时吸收到启动阶段——
 * 避免子代理首次检索才构建导致的延迟与「无索引」间歇。纯函数（数据注入、不读时钟）。
 */
export async function ensureDatabaseIndexes(dataDir, nodeId, flow, engine, logger) {
    const sources = dbInEdges(flow, nodeId)
        .map((line) => nodeById(flow, line.source))
        .filter((n) => n?.kind === 'database');
    for (const node of sources) {
        try {
            const index = new VectorIndex(indexPathOf(dataDir, node.id));
            const file = await index.load();
            if (file && file.chunks.length > 0)
                continue;
            const { file: rebuilt } = await buildIndexForDatabase(dataDir, node, engine);
            logger?.warn(`[visual-workflow] 已为数据节点「${node.data.label || node.id}」预建索引（${rebuilt.source}，${rebuilt.chunks.length} 块）`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger?.warn(`[visual-workflow] 数据节点「${node.data.label || node.id}」索引预建失败：${message}`);
        }
    }
}
//# sourceMappingURL=service.js.map