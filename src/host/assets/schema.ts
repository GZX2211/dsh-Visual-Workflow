// src/host/assets/schema.ts
//
// 资产库磁盘形状（DDL 常量 + 幂等建表）。
//
// 磁盘形状属对外契约：外部备份、排障与迁移都依赖它，因此 DDL 只在此文件出现一次。
// 事务语义：资产历史行「内容不可变」——回滚只挪 Active 指针，历史行永不改写；
// 因此 reference_* 与 role_asset_type 这类统计/类型字段是**可变的缓存列**，
// 其可变性由本模块显式维护（见 role-assets.ts / workflow-assets.ts）。

import type { DatabaseSync } from 'node:sqlite'

/** 库文件相对插件 dataDir 的固定文件名。 */
export const ASSET_DB_FILE = 'assets.db'

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
export function roleAssetHistoryDdl(tableName: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('parent','agent')),
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL DEFAULT '',
  preset_id TEXT NOT NULL DEFAULT '',
  retry_limit INTEGER NOT NULL DEFAULT 0 CHECK (retry_limit >= 0),
  react_limit INTEGER CHECK (react_limit IS NULL OR react_limit >= 0),
  input_schema TEXT,
  output_schema TEXT,
  system_prompt_source TEXT,
  inject_system_prompt INTEGER NOT NULL DEFAULT 1 CHECK (inject_system_prompt IN (0,1)),
  inject_tool_sections INTEGER NOT NULL DEFAULT 1 CHECK (inject_tool_sections IN (0,1)),
  prompt_file_path TEXT,
  retrieval_context TEXT,
  role_asset_type TEXT NOT NULL CHECK (role_asset_type IN ('standalone','inline','shared')),
  reference_status TEXT NOT NULL DEFAULT 'unused' CHECK (reference_status IN ('unused','used')),
  reference_workflow_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reference_workflow_ids)),
  source TEXT NOT NULL CHECK (source IN ('human','agent')),
  source_template_id TEXT,
  source_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(asset_id, version_id)
)`
}

export const ROLE_ASSET_HISTORY_DDL = roleAssetHistoryDdl('role_asset_history')

export const ROLE_ASSET_HISTORY_INDEXES_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_role_history_asset_id ON role_asset_history(asset_id)',
  'CREATE INDEX IF NOT EXISTS idx_role_history_status ON role_asset_history(reference_status)',
]

/**
 * 为什么 role_version_ids 存对象数组而非扁平 id 数组：工作流图重建必须知道
 * 「哪个 roleVersionId 属于哪个节点」，扁平数组丢失节点映射后无法还原节点壳。
 */
export const WORKFLOW_ASSET_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS workflow_asset_history (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mode1','mode2')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role_version_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(role_version_ids)),
  nodes_json TEXT NOT NULL CHECK (json_valid(nodes_json)),
  lines_json TEXT NOT NULL CHECK (json_valid(lines_json)),
  meta_json TEXT CHECK (meta_json IS NULL OR json_valid(meta_json)),
  retrieval_context TEXT,
  source TEXT NOT NULL CHECK (source IN ('human','agent')),
  source_run_id TEXT,
  source_template_id TEXT,
  source_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(asset_id, version_id)
)`

export const WORKFLOW_ASSET_HISTORY_INDEXES_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_workflow_history_asset_id ON workflow_asset_history(asset_id)',
]

/**
 * Active 索引：每个逻辑资产一行，退役 = 删行（历史保留）。
 * source_template_id / source_fingerprint 为何冗余在此：入库按钮的锁定判定与
 * 「同一模版二次晋升走新版本」都要按模版定位当前绑定，避免每次回表取历史行。
 */
export const ROLE_ASSET_ACTIVE_DDL = `
CREATE TABLE IF NOT EXISTS role_asset_active (
  asset_id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  retrieval_context TEXT NOT NULL,
  embedding BLOB,
  embedding_dimension INTEGER,
  embedding_source TEXT,
  embedding_model TEXT,
  source_template_id TEXT,
  source_fingerprint TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id, version_id) REFERENCES role_asset_history(asset_id, version_id)
)`

export const ROLE_ASSET_ACTIVE_INDEXES_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_role_active_version ON role_asset_active(asset_id, version_id)',
]

export const WORKFLOW_ASSET_ACTIVE_DDL = `
CREATE TABLE IF NOT EXISTS workflow_asset_active (
  asset_id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  retrieval_context TEXT NOT NULL,
  embedding BLOB,
  embedding_dimension INTEGER,
  embedding_source TEXT,
  embedding_model TEXT,
  source_template_id TEXT,
  source_fingerprint TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id, version_id) REFERENCES workflow_asset_history(asset_id, version_id)
)`

export const WORKFLOW_ASSET_ACTIVE_INDEXES_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_workflow_active_version ON workflow_asset_active(asset_id, version_id)',
]

/**
 * 经验表：没有版本控制（无历史表、也没有 Active 指针表），状态只有 is_active 两态。
 * 为什么状态放在行上而不是像资产那样用 Active 表：经验没有版本，"活跃" 只是
 * 「是否进入父代理召回面」这一个布尔事实，另建一张表等于给单布尔事实造第二处写入边界。
 */
export const EXPERIENCES_DDL = `
CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  source_run_id TEXT,
  reflection_prompt_version TEXT NOT NULL DEFAULT '1',
  task_type TEXT NOT NULL,
  task_context TEXT NOT NULL,
  insight TEXT NOT NULL,
  evidence TEXT,
  review_feedback TEXT,
  reviewed_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

export const EXPERIENCES_INDEXES_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_experiences_task_type ON experiences(task_type)',
  'CREATE INDEX IF NOT EXISTS idx_experiences_source_run_id ON experiences(source_run_id)',
  'CREATE INDEX IF NOT EXISTS idx_experiences_created_at ON experiences(created_at)',
]

/** 经验活跃态索引（召回面过滤按 is_active 等值走索引）。 */
export const EXPERIENCES_ACTIVE_INDEX_DDL = 'CREATE INDEX IF NOT EXISTS idx_experiences_active ON experiences(is_active)'

/** 全部建表语句（顺序即依赖顺序：先历史后 Active，外键才可解析）。 */
export const SCHEMA_STATEMENTS: string[] = [
  ROLE_ASSET_HISTORY_DDL,
  ...ROLE_ASSET_HISTORY_INDEXES_DDL,
  WORKFLOW_ASSET_HISTORY_DDL,
  ...WORKFLOW_ASSET_HISTORY_INDEXES_DDL,
  ROLE_ASSET_ACTIVE_DDL,
  ...ROLE_ASSET_ACTIVE_INDEXES_DDL,
  WORKFLOW_ASSET_ACTIVE_DDL,
  ...WORKFLOW_ASSET_ACTIVE_INDEXES_DDL,
  EXPERIENCES_DDL,
  ...EXPERIENCES_INDEXES_DDL,
]

/** 幂等建表：全部 `IF NOT EXISTS`，重复调用不改变既有库。 */
export function initSchema(db: DatabaseSync): void {
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
  ensureExperienceActiveColumn(db)
  retireJsonSchemaCheck(db)
}

/** 重建用的临时表名（只在迁移事务内存在；固定名字便于中断后人工排查）。 */
const ROLE_HISTORY_REBUILD_TABLE = 'role_asset_history__rebuild'

/**
 * 已退役约束的判定文本。
 * 为什么判定表定义原文而不用版本号：既有库可能在任意历史版本被创建且无版本记账，
 * sqlite_master 里的原文是唯一可信事实；判定是幂等的（重建后原文即不再含该文本）。
 */
const RETIRED_INPUT_SCHEMA_CHECK = 'json_valid(input_schema)'

/** 表的列名（按 DDL 声明顺序；PRAGMA 不支持参数绑定，入参只允许本文件的表名常量）。 */
function tableColumns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[]
  return rows.map((row) => String(row.name))
}

/**
 * 经验状态列（is_active）的幂等补齐：存量库由早期版本建立、没有该列，直接查询会报
 * `no such column`。ALTER TABLE ADD COLUMN 是 SQLite 上唯一不重建表的加列方式，
 * 已有该列时跳过（新建库由 EXPERIENCES_DDL 直接带上，此处为无操作）。
 *
 * 为什么默认 1（活跃）：历史数据全部是「入库即生效」的经验，按活跃读取与旧行为一致。
 * 索引必须在本函数内建：放在 SCHEMA_STATEMENTS 里会在存量库上引用尚不存在的列而失败。
 */
function ensureExperienceActiveColumn(db: DatabaseSync): void {
  if (!tableColumns(db, 'experiences').includes('is_active')) {
    db.exec('ALTER TABLE experiences ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))')
  }
  db.exec(EXPERIENCES_ACTIVE_INDEX_DDL)
}

/**
 * 退役 input_schema / output_schema 的 json_valid 约束（存量库表重建）。
 *
 * 为什么必须重建：SQLite 不支持 DROP CONSTRAINT，只能按官方流程换表——
 * 建同形新表 → 搬数据 → 丢旧表 → 改名回原表名 → 重建索引，全程一笔事务，失败即回滚。
 * 为什么先关外键：role_asset_active 以 (asset_id, version_id) 外键引用本表，
 * 删父表时若外键生效会立即失败；该 PRAGMA 在事务内无效，因此必须在 BEGIN 之前设置。
 * 为什么开 legacy_alter_table：默认改名会连带改写其它表定义里对该表的引用，
 * 关掉它才能让 role_asset_active 的外键继续指向重建后的同名表。
 */
function retireJsonSchemaCheck(db: DatabaseSync): void {
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'role_asset_history'")
    .get() as Record<string, unknown> | undefined
  if (!definition || !String(definition.sql ?? '').includes(RETIRED_INPUT_SCHEMA_CHECK)) return

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('PRAGMA legacy_alter_table = ON')
      db.exec(roleAssetHistoryDdl(ROLE_HISTORY_REBUILD_TABLE))
      // 重建只退役约束、不改列集合；列序不一致说明库来自未知形状，宁可报错也不搬错数据
      const previous = tableColumns(db, 'role_asset_history').join(',')
      const rebuilt = tableColumns(db, ROLE_HISTORY_REBUILD_TABLE).join(',')
      if (previous !== rebuilt) {
        throw new Error(`资产库 role_asset_history 列集合与当前形状不符（库中：${previous}），请备份后人工迁移`)
      }
      db.exec(`INSERT INTO ${ROLE_HISTORY_REBUILD_TABLE} SELECT * FROM role_asset_history`)
      db.exec('DROP TABLE role_asset_history')
      db.exec(`ALTER TABLE ${ROLE_HISTORY_REBUILD_TABLE} RENAME TO role_asset_history`)
      for (const statement of ROLE_ASSET_HISTORY_INDEXES_DDL) db.exec(statement)
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 事务可能已被 SQLite 因错误自动回滚，此处只保证不覆盖原始错误
      }
      throw error
    } finally {
      db.exec('PRAGMA legacy_alter_table = OFF')
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}
