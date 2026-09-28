import type { DatabaseSync } from 'node:sqlite';
/** 库文件相对插件 dataDir 的固定文件名。 */
export declare const ASSET_DB_FILE = "assets.db";
/**
 * 为什么 reference_status 是独立列而不是从 reference_workflow_ids 推导：
 * idx_role_history_status 需要可索引的等值列做「已引用」过滤，JSON 数组长度判断
 * 无法走索引；该列由引用统计在写入时同步刷新，与数组长度恒一致（不变量）。
 *
 * input_schema / output_schema 不带 json_valid 约束：这两列承载的是「交接契约」说明文本
 * （见 shared/graph-model.ts 的 RoleNode.data），语义为**柔性文本、不做结构校验**，
 * 空值即未配置。若按 JSON 校验，节点默认空串与自由文本表述（如「上游结论；产出文件路径」）
 * 都会被拒绝，入库整体失败。
 */
export declare function roleAssetHistoryDdl(tableName: string): string;
export declare const ROLE_ASSET_HISTORY_DDL: string;
export declare const ROLE_ASSET_HISTORY_INDEXES_DDL: string[];
/**
 * 为什么 role_version_ids 存对象数组而非扁平 id 数组：工作流图重建必须知道
 * 「哪个 roleVersionId 属于哪个节点」，扁平数组丢失节点映射后无法还原节点壳。
 */
export declare const WORKFLOW_ASSET_HISTORY_DDL = "\nCREATE TABLE IF NOT EXISTS workflow_asset_history (\n  id TEXT PRIMARY KEY,\n  version_id INTEGER NOT NULL,\n  asset_id TEXT NOT NULL,\n  mode TEXT NOT NULL CHECK (mode IN ('mode1','mode2')),\n  name TEXT NOT NULL,\n  description TEXT NOT NULL DEFAULT '',\n  role_version_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(role_version_ids)),\n  nodes_json TEXT NOT NULL CHECK (json_valid(nodes_json)),\n  lines_json TEXT NOT NULL CHECK (json_valid(lines_json)),\n  meta_json TEXT CHECK (meta_json IS NULL OR json_valid(meta_json)),\n  retrieval_context TEXT,\n  source TEXT NOT NULL CHECK (source IN ('human','agent')),\n  source_run_id TEXT,\n  source_template_id TEXT,\n  source_fingerprint TEXT,\n  created_at INTEGER NOT NULL,\n  UNIQUE(asset_id, version_id)\n)";
export declare const WORKFLOW_ASSET_HISTORY_INDEXES_DDL: string[];
/**
 * Active 索引：每个逻辑资产一行，退役 = 删行（历史保留）。
 * source_template_id / source_fingerprint 为何冗余在此：入库按钮的锁定判定与
 * 「同一模版二次晋升走新版本」都要按模版定位当前绑定，避免每次回表取历史行。
 */
export declare const ROLE_ASSET_ACTIVE_DDL = "\nCREATE TABLE IF NOT EXISTS role_asset_active (\n  asset_id TEXT PRIMARY KEY,\n  version_id INTEGER NOT NULL,\n  name TEXT NOT NULL,\n  retrieval_context TEXT NOT NULL,\n  embedding BLOB,\n  embedding_dimension INTEGER,\n  embedding_source TEXT,\n  embedding_model TEXT,\n  source_template_id TEXT,\n  source_fingerprint TEXT,\n  updated_at INTEGER NOT NULL,\n  FOREIGN KEY (asset_id, version_id) REFERENCES role_asset_history(asset_id, version_id)\n)";
export declare const ROLE_ASSET_ACTIVE_INDEXES_DDL: string[];
export declare const WORKFLOW_ASSET_ACTIVE_DDL = "\nCREATE TABLE IF NOT EXISTS workflow_asset_active (\n  asset_id TEXT PRIMARY KEY,\n  version_id INTEGER NOT NULL,\n  name TEXT NOT NULL,\n  retrieval_context TEXT NOT NULL,\n  embedding BLOB,\n  embedding_dimension INTEGER,\n  embedding_source TEXT,\n  embedding_model TEXT,\n  source_template_id TEXT,\n  source_fingerprint TEXT,\n  updated_at INTEGER NOT NULL,\n  FOREIGN KEY (asset_id, version_id) REFERENCES workflow_asset_history(asset_id, version_id)\n)";
export declare const WORKFLOW_ASSET_ACTIVE_INDEXES_DDL: string[];
export declare const EXPERIENCES_DDL = "\nCREATE TABLE IF NOT EXISTS experiences (\n  id TEXT PRIMARY KEY,\n  source_run_id TEXT,\n  reflection_prompt_version TEXT NOT NULL DEFAULT '1',\n  task_type TEXT NOT NULL,\n  task_context TEXT NOT NULL,\n  insight TEXT NOT NULL,\n  evidence TEXT,\n  review_feedback TEXT,\n  reviewed_at INTEGER,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n)";
export declare const EXPERIENCES_INDEXES_DDL: string[];
/** 全部建表语句（顺序即依赖顺序：先历史后 Active，外键才可解析）。 */
export declare const SCHEMA_STATEMENTS: string[];
/** 幂等建表：全部 `IF NOT EXISTS`，重复调用不改变既有库。 */
export declare function initSchema(db: DatabaseSync): void;
