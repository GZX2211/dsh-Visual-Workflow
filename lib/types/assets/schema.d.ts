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
/**
 * 经验生成 Prompt 表：每个主体类型**至多一行活跃**，历史版本以 is_active = 0 保留。
 *
 * 为什么活跃唯一性必须由数据库保证：并发写入、外部工具改库、补数据脚本都会绕过本模块的
 * 代码路径，只有部分唯一索引是任何写入者都绕不开的边界（TS 侧约定只能约束自家调用点）。
 */
export declare const EXPERIENCE_PROMPTS_DDL = "\nCREATE TABLE IF NOT EXISTS experience_prompts (\n  id TEXT PRIMARY KEY,\n  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','team','orchestrator')),\n  name TEXT NOT NULL,\n  description TEXT,\n  prompt TEXT NOT NULL,\n  prompt_version TEXT NOT NULL,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n)";
export declare const EXPERIENCE_PROMPTS_INDEXES_DDL: string[];
/**
 * 经验表：没有版本控制（无历史表、也没有 Active 指针表），状态只有 is_active 两态。
 * 为什么状态放在行上而不是像资产那样用 Active 表：经验没有版本，「活跃」只是
 * 「是否进入召回面」这一个布尔事实，另建一张表等于给单布尔事实造第二处写入边界。
 *
 * 向量两列以 BLOB 存真实数值（Float64 字节序列），维度单独成列：SQLite 无向量类型，
 * 而维度与字节长度互为校验，读侧据此判定一行是否真的可用于语义召回。
 */
export declare const EXPERIENCES_DDL = "\nCREATE TABLE IF NOT EXISTS experiences (\n  id TEXT PRIMARY KEY,\n  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','team','orchestrator')),\n  responsibility TEXT NOT NULL,\n  task_type TEXT NOT NULL,\n  decision_domain TEXT NOT NULL,\n  situation TEXT NOT NULL,\n  trigger TEXT NOT NULL,\n  principle TEXT NOT NULL,\n  recommended_action TEXT NOT NULL,\n  exclusions TEXT NOT NULL CHECK (json_valid(exclusions)),\n  evidence TEXT NOT NULL CHECK (json_valid(evidence)),\n  task_retrieval_text TEXT NOT NULL,\n  task_embedding BLOB,\n  decision_retrieval_text TEXT NOT NULL,\n  decision_embedding BLOB,\n  embedding_model TEXT,\n  embedding_dimension INTEGER,\n  source_run_id TEXT NOT NULL,\n  generation_prompt_id TEXT NOT NULL REFERENCES experience_prompts(id),\n  generation_prompt_version TEXT NOT NULL,\n  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n)";
export declare const EXPERIENCES_INDEXES_DDL: string[];
/**
 * 使用事实表：一行 = 一次「该经验被显式注入 agent 上下文」。
 *
 * 只有 INSERT / SELECT 两类语句，因此没有 updated_at：历史事实不可变，写入即终态。
 * 为什么带外键：使用事实必须属于真实存在的经验，否则「该主体是否被注入过这条经验」的准入判据
 * 会与经验表脱节（评价准入是 feedback 的唯一防线）。
 */
export declare const EXPERIENCE_USAGE_DDL = "\nCREATE TABLE IF NOT EXISTS experience_usage (\n  id TEXT PRIMARY KEY,\n  experience_id TEXT NOT NULL REFERENCES experiences(id),\n  run_id TEXT NOT NULL,\n  subject_id TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n)";
export declare const EXPERIENCE_USAGE_INDEXES_DDL: string[];
/**
 * 评价事实表：四维评分只允许五级锚点，取值约束由数据库保证（TS 联合类型运行期不存在）。
 *
 * 同样只有 INSERT / SELECT：评价历史是统计投影的唯一事实源，一旦允许改写历史，
 * 「改公式后重放历史」（§25）就失去意义。为什么记录评分者主体与模型：为未来的评分者校准留数据
 * （§6.2），V1 不做任何归一化。
 */
export declare const EXPERIENCE_EVALUATION_DDL = "\nCREATE TABLE IF NOT EXISTS experience_evaluation (\n  id TEXT PRIMARY KEY,\n  experience_id TEXT NOT NULL REFERENCES experiences(id),\n  run_id TEXT NOT NULL,\n  fit_score REAL NOT NULL CHECK(fit_score IN (0,0.25,0.5,0.75,1)),\n  decision_effect REAL NOT NULL CHECK(decision_effect IN (-1,-0.5,0,0.5,1)),\n  information_gain REAL NOT NULL CHECK(information_gain IN (0,0.25,0.5,0.75,1)),\n  causal_confidence REAL NOT NULL CHECK(causal_confidence IN (0,0.25,0.5,0.75,1)),\n  evidence TEXT NOT NULL DEFAULT '',\n  evaluator_subject_id TEXT NOT NULL,\n  evaluator_model TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL\n)";
export declare const EXPERIENCE_EVALUATION_INDEXES_DDL: string[];
/**
 * 统计投影表：`experience_id` 即主键（每个经验至多一行），全部数值列都是**可重建的派生结果**（§3.2）。
 *
 * 为什么 quality_signal 也要落盘：它是召回修正（§17）的直接输入，读取路径是 getStats；
 * 不落盘就得在读取侧第二次实现 §14 的公式，违反「公式单一本体」。
 * 为什么没有删除精度/级联：经验只有归档没有删除，孤立统计行由 rebuildStats 整表覆盖清除（§24）。
 */
export declare const EXPERIENCE_STATS_DDL = "\nCREATE TABLE IF NOT EXISTS experience_stats (\n  experience_id TEXT PRIMARY KEY REFERENCES experiences(id),\n  effective_sample_count REAL NOT NULL,\n  recalled_count INTEGER NOT NULL,\n  used_count INTEGER NOT NULL,\n  fit_mean REAL NOT NULL,\n  empirical_value REAL NOT NULL,\n  variance REAL NOT NULL,\n  stability REAL NOT NULL,\n  evidence_strength REAL NOT NULL,\n  harm_count INTEGER NOT NULL,\n  harm_rate REAL NOT NULL,\n  harm_severity REAL NOT NULL,\n  quality_signal REAL NOT NULL,\n  trust REAL NOT NULL,\n  updated_at INTEGER NOT NULL\n)";
export declare const EXPERIENCE_STATS_INDEXES_DDL: string[];
/**
 * 全部建表语句（顺序即依赖顺序：先历史后 Active、先 Prompt 后经验、先经验后评价闭环，
 * 外键才可解析）。评价闭环三表带外键引用 experiences，因此必须排在经验表之后。
 */
export declare const SCHEMA_STATEMENTS: string[];
/**
 * 幂等建表：全部 `IF NOT EXISTS`，重复调用不改变既有库。
 *
 * 经验索引不放进 SCHEMA_STATEMENTS：旧形状的 experiences 还没有 experience_type 列，
 * 先建索引会因「no such column」失败，必须等形状迁移完成后再建。
 */
export declare function initSchema(db: DatabaseSync, now?: () => number): void;
