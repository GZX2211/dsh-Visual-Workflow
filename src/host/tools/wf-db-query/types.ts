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
}

/** 表结构条目。 */
export interface TableInfo {
  name: string
}

/** 数据库驱动接口（testConnection/query/schema/schemaPage/close）。 */
export interface DatabaseDriver {
  testConnection(): Promise<void>
  query(sql: string): Promise<QueryResult>
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
