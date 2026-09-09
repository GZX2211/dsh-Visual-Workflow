import type { DatabaseNode, WorkflowDocument } from '../shared/graph-model.js';
import type { OrchestratorRuntime } from '../orchestrator/runtime.js';
import type { FlowStore } from '../storage/flow-store.js';
import type { EmbeddingEngine } from '../embedding/engine.js';
import { type VectorIndexFile } from '../embedding/indexer.js';
/** SQL 校验结果：通过（含规范化后的单条 SQL）或拒绝（错误原因）。 */
export type SqlCheckResult = {
    ok: true;
    sql: string;
} | {
    ok: false;
    error: string;
};
/**
 * 只读 SQL 白名单校验：
 *   - 剥离注释（行注释与块注释）后 trim；空 → 拒绝；
 *   - 多语句拒绝（去除尾部单分号后仍含分号）；
 *   - 首关键字必须 SELECT；
 *   - 写/DDL 关键字黑名单（词边界）拒绝；
 *   - 文件导出（INTO OUTFILE/DUMPFILE）拒绝；
 *   - 必须携带 LIMIT 数字（强制行数上限，防全表拉取）。
 */
export declare function sanitizeReadOnlySql(raw: string): SqlCheckResult;
/** 查询结果（columns 与 rows 对齐；rows 内值已 String 化，便于模型读取与 schema 表达）。 */
export interface QueryResult {
    columns: string[];
    rows: string[][];
}
/** 表结构条目。 */
export interface TableInfo {
    name: string;
}
/** 数据库驱动接口（testConnection/query/schema/close）。 */
export interface DatabaseDriver {
    testConnection(): Promise<void>;
    query(sql: string): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
    close(): void;
}
/** 本地 SQLite 驱动：node:sqlite 只读模式（物理防写）。 */
export declare class SqliteDriver implements DatabaseDriver {
    private readonly filePath;
    private db;
    constructor(filePath: string);
    private open;
    testConnection(): Promise<void>;
    query(sql: string): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
    close(): void;
}
/** 服务器连接信息（mysql/postgresql 共用）。 */
export interface ServerConnection {
    dbKind: 'mysql' | 'postgresql';
    host: string;
    port: number;
    user: string;
    password: string;
    db: string;
}
/**
 * 服务器驱动：惰性加载 mysql2/pg（可选依赖）。
 * 驱动未安装时给明确错误（含安装提示）；连接使用完即关（不保留长连接）。
 */
export declare class ServerDriver implements DatabaseDriver {
    private readonly conn;
    constructor(conn: ServerConnection);
    private requireHost;
    private queryMysql;
    private queryPostgres;
    testConnection(): Promise<void>;
    query(sql: string): Promise<QueryResult>;
    schema(): Promise<TableInfo[]>;
    close(): void;
}
/** 按数据库节点创建驱动（本地/服务器；配置缺失给明确错误）。 */
export declare function createDatabaseDriver(node: DatabaseNode): DatabaseDriver;
/** 连接测试（GUI dbTest 端点与运行期共用；返回可展示消息）。 */
export declare function testDatabaseConnection(node: DatabaseNode): Promise<{
    ok: boolean;
    message: string;
}>;
/** 索引构建行数上限（防超大库打爆内存；超限截断并返回截断标记）。 */
export declare const INDEX_MAX_ROWS = 10000;
/**
 * 判定单元格是否为「向量/嵌入」型值：逗号分隔的浮点数组（≥16 个 token 且 ≥90% 为 float）。
 * 用于索引文本构建排除向量列与 query 结果保护。纯函数。
 */
export declare function isVectorLikeValue(value: string): boolean;
/**
 * 识别需排除的「向量/嵌入」列（供索引文本构建跳过）：列名启发式 + 首行值形态双重判定。
 * 向量列对语义检索文本无意义，且会大幅膨胀索引体积。纯函数。
 */
export declare function skipVectorColumns(columns: string[], rows: string[][]): Set<string>;
/**
 * 识别适用于做「行主键」的列下标（供命中回传 rowKey）：优先精确主键名（id/pk/uuid/key/编号/code），
 * 其次任意含 id/key/code/no 的列名；找不到返回 -1。纯函数。
 */
export declare function detectKeyIndex(columns: string[]): number;
/**
 * 按数据库类型生成标识符引用：SQLite/PostgreSQL 用双引号，MySQL 用反引号（转义内嵌引号）。
 * 索引构建对表名做自动引用，避免服务器库（尤其 MySQL）对 `FROM "table"` 的语法误判。
 */
export declare function quoteDbIdentifier(node: DatabaseNode, name: string): string;
/**
 * 为数据库节点（本地 SQLite / 服务器 MySQL-PostgreSQL）构建向量索引：
 * 全表全行文本化（列值 join；跳过向量/嵌入列）后按行分块，原子持久化到
 * <dataDir>/data/vector/<dataId>.json。嵌入可用时写入向量，否则自动落 BM25 索引。
 * 本地与服务器共用同一套本地索引基础设施（一致性；服务器只需提供只读查询能力）。
 */
export declare function buildIndexForDatabase(dataDir: string, node: DatabaseNode, engine: EmbeddingEngine): Promise<{
    file: VectorIndexFile;
    truncated: boolean;
}>;
/** 索引文件路径（安全文件名：dataId 消毒）。 */
export declare function indexPathOf(dataDir: string, dataId: string): string;
/**
 * 为某角色节点的 db-in 所连数据库「确保索引已建立」。
 * - 已存在且非空 → 复用（不重复重建，避免多节点共享同一库时反复全量嵌入）；
 * - 缺失/为空 → 构建（本地与服务器库均可；嵌入不可用时自动落 BM25）；
 * - 单库构建失败 → best-effort 记 warn 不抛错，交由 wf_db_query(mode=search) 惰性构建兜底。
 * 运行期在启动节点子代理之前调用，把索引构建耗时吸收到启动阶段——
 * 避免子代理首次检索才构建导致的延迟与「无索引」间歇。纯函数（数据注入、不读时钟）。
 */
export declare function ensureDatabaseIndexes(dataDir: string, nodeId: string, flow: WorkflowDocument, engine: EmbeddingEngine, logger?: {
    warn(message: string): void;
}): Promise<void>;
/** 工具层所需宿主能力。 */
export interface DataToolsHost {
    orchestrator: OrchestratorRuntime;
    store: FlowStore;
    dataDir: string;
    engine: EmbeddingEngine;
}
/** 查询结果单元格值最大长度（超长截断防止向量/BLOB 列打爆上下文；追加标记）。 */
export declare const QUERY_CELL_MAX_LENGTH = 240;
/** 工具定义注册（全局层；disposer 随 fiber 注销）。 */
export declare function registerDataTools(ctx: {
    get(name: string): unknown;
}, host: DataToolsHost): () => void;
