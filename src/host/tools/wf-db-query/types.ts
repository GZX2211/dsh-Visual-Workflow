// src/host/tools/wf-db-query/types.ts
//
// wf_db_query 的契约类型：查询结果 / 驱动接口 / 服务器连接 / SQL 校验结果 / 工具宿主缝。
// 纯类型（无 IO、无运行时依赖），供同目录 driver/service/policy/tool 与外部消费者共用。

import type { OrchestratorRuntime } from '../../orchestrator/index.js'
import type { DatabaseNode } from '../../shared/graph-model.js'
import type { FlowStore } from '../../storage/flow-store.js'
import type { EmbeddingEngine } from '../../embedding/engine.js'

/** SQL 校验结果：通过（含规范化后的单条 SQL）或拒绝（错误原因）。 */
export type SqlCheckResult = { ok: true; sql: string } | { ok: false; error: string }

/** 查询结果（columns 与 rows 对齐；rows 内值已 String 化，便于模型读取与 schema 表达）。 */
export interface QueryResult {
  columns: string[]
  rows: string[][]
  /**
   * rows 是否被**执行层上限**截断（驱动在 maxRows 之外仍读到了下一行）。
   * 只在传入 QueryOptions.maxRows 时设置：未设上限时该事实无从谈起，由调用方按自身口径判定。
   */
  truncated?: boolean
}

/** 表结构条目。 */
export interface TableInfo {
  name: string
}

/**
 * 查询调用选项：执行层行数上限的唯一入口（后续语句级取消/超时在此扩展，调用形状不变）。
 * 上限必须由执行层落实——`LIMIT 999999999` 这类形式约束与不写 LIMIT 在内存物化上等价。
 */
export interface QueryOptions {
  /**
   * 最多返回的行数（≥1；非有限或 <1 视为未设上限）。
   * 驱动读取到 maxRows + 1 行即停止（+1 仅用于判定截断），返回前截到 maxRows。
   */
  maxRows?: number
}

/** 数据库驱动接口（testConnection/query/schema/schemaPage/close）。 */
export interface DatabaseDriver {
  testConnection(): Promise<void>
  /**
   * 执行只读查询。传 options.maxRows 时驱动必须**逐行读取**并在读满上限后停止（不全量物化），
   * rows 截到 maxRows，truncated 如实上报是否还有更多行；未传时行为与全量读取一致。
   */
  query(sql: string, options?: QueryOptions): Promise<QueryResult>
  schema(): Promise<TableInfo[]>
  /**
   * 表清单页：查询取「上限+1」行，返回截到上限的清单与精确截断事实（是否还有更多表）。
   * 与 schema() 同源同顺序；需要判断表清单是否被上限截断时用本方法。
   */
  schemaPage(): Promise<{ tables: TableInfo[]; truncated: boolean }>
  close(): void
}

/** 驱动工厂：把数据节点解析为驱动（缺省实现是 driver.ts 的 createDatabaseDriver）。 */
export type DatabaseDriverFactory = (node: DatabaseNode) => DatabaseDriver

/** 服务器连接信息（mysql/postgresql 共用）。 */
export interface ServerConnection {
  dbKind: 'mysql' | 'postgresql'
  host: string
  port: number
  user: string
  password: string
  db: string
}

/** 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。 */
export interface WfDbQueryHost {
  orchestrator: OrchestratorRuntime
  store: FlowStore
  dataDir: string
  engine: EmbeddingEngine
  /**
   * 可选驱动工厂：注入 fake 驱动即可覆盖「服务器库（mysql/postgresql）检索可用」路径。
   * 不注入时行为与真实驱动完全一致（缺省即 createDatabaseDriver）。
   */
  createDriver?: DatabaseDriverFactory
}
