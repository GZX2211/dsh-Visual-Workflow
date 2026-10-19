// src/host/assets/schema.ts
//
// 资产库磁盘形状（DDL 常量 + 幂等建表）。
//
// 磁盘形状属对外契约：外部备份、排障与迁移都依赖它，因此 DDL 只在此文件出现一次。
// 事务语义：资产历史行「内容不可变」——回滚只挪 Active 指针，历史行永不改写；
// 因此 reference_* 与 role_asset_type 这类统计/类型字段是**可变的缓存列**，
// 其可变性由本模块显式维护（见 role-assets.ts / workflow-assets.ts）。
import { EXPERIENCE_PROMPT_ASSET_IDS, EXPERIENCE_PROMPT_SEEDS } from './experience-seeds.js';
import { versionRowId } from './ids.js';
/** 库文件相对插件 dataDir 的固定文件名。 */
export const ASSET_DB_FILE = 'assets.db';
/**
 * 为什么 reference_status 是独立列而不是从 reference_workflow_ids 推导：
 * idx_role_history_status 需要可索引的等值列做「已引用」过滤，JSON 数组长度判断
 * 无法走索引；该列由引用统计在写入时同步刷新，与数组长度恒一致（不变量）。
 *
 * input_schema / output_schema 不带 json_valid 约束：这两列承载的是「节点输入/输出契约」
 * 说明文本（见 shared/graph-model.ts 的 RoleNode.data），语义为**柔性文本、不做结构校验**，
 * 空值即未配置。若按 JSON 校验，节点默认空串与自由文本表述（如「上游结论；产出文件路径」）
 * 都会被拒绝，入库整体失败。
 */
export function roleAssetHistoryDdl(tableName) {
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
)`;
}
export const ROLE_ASSET_HISTORY_DDL = roleAssetHistoryDdl('role_asset_history');
export const ROLE_ASSET_HISTORY_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_role_history_asset_id ON role_asset_history(asset_id)',
    'CREATE INDEX IF NOT EXISTS idx_role_history_status ON role_asset_history(reference_status)',
];
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
)`;
export const WORKFLOW_ASSET_HISTORY_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_workflow_history_asset_id ON workflow_asset_history(asset_id)',
];
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
)`;
export const ROLE_ASSET_ACTIVE_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_role_active_version ON role_asset_active(asset_id, version_id)',
];
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
)`;
export const WORKFLOW_ASSET_ACTIVE_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_workflow_active_version ON workflow_asset_active(asset_id, version_id)',
];
/**
 * 经验生成提示词的历史版本表（表名可参数化，供迁移建同形新表复用）。
 *
 * 形状与其他资产历史表同构：版本行写入即不可变，`<asset_id>@<version_id>` 是版本行 id；
 * 当前生效版本由 `experience_prompt_active` 指针表达，不再在行上放 `is_active`。
 *
 * 名称 / 描述 / 主体类型是资产的固定身份，只有正文可编辑；因此版本行仍保存这些字段，
 * 回放历史版本时无需回表猜当前值。
 *
 * `experience_type` 的取值域曾在退役 team 类型时收窄（'team' 永久移除），
 * 存量库由 retireTeamExperienceType 与 migrateExperiencePromptsToAssets 依次收口。
 */
function experiencePromptsDdl(tableName) {
    return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','orchestrator')),
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('human','agent')),
  created_at INTEGER NOT NULL,
  UNIQUE(asset_id, version_id)
)`;
}
export const EXPERIENCE_PROMPTS_DDL = experiencePromptsDdl('experience_prompts');
export const EXPERIENCE_PROMPTS_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experience_prompts_type ON experience_prompts(experience_type)',
    'CREATE INDEX IF NOT EXISTS idx_experience_prompts_asset ON experience_prompts(asset_id)',
];
/**
 * 提示词资产的 Active 指针表。
 *
 * 与其他资产一致：一行 = 一条逻辑资产的当前版本；回滚只改此表，历史行不动。
 * 结构性差异：本表**没有删除路径**（归档被禁止），每个主体类型恰好一行，
 * 由 `experience_type` 唯一索引与初始化自愈共同保证「指针必须保持活跃」。
 */
export const EXPERIENCE_PROMPT_ACTIVE_DDL = `
CREATE TABLE IF NOT EXISTS experience_prompt_active (
  asset_id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','orchestrator')),
  name TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id, version_id) REFERENCES experience_prompts(asset_id, version_id)
)`;
export const EXPERIENCE_PROMPT_ACTIVE_INDEXES_DDL = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_experience_prompt_active_type ON experience_prompt_active(experience_type)',
];
/**
 * 提示词资产化之前的旧形状：行上带 `is_active`、没有版本号与资产 id。
 *
 * 保留独立 DDL 只服务两处迁移：team 类型退役迁移需要按旧形状重建表；提示词资产化迁移
 * 需要按旧列清单读取数据。新代码不得再写入此形状。
 */
function legacyExperiencePromptsDdl(tableName) {
    return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','orchestrator')),
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;
}
/**
 * 两张表的列清单（顺序即 DDL 声明顺序）。
 *
 * 为什么需要它：迁移搬数据时按列名显式搬迁，`SELECT *` 一旦遇到列序漂移就会静默搬错值。
 * 这里只声明列名（迁移只需列名），不复制列类型——类型仍以 DDL 为唯一本体。
 */
const LEGACY_EXPERIENCE_PROMPT_COLUMNS = [
    'id',
    'experience_type',
    'name',
    'description',
    'prompt',
    'prompt_version',
    'is_active',
    'created_at',
    'updated_at',
];
/** 旧形状索引：team 退役迁移按旧表重建时必须恢复旧索引，等提示词资产化迁移再换成新索引。 */
const LEGACY_EXPERIENCE_PROMPTS_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experience_prompts_type ON experience_prompts(experience_type)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_experience_prompts_active_type ON experience_prompts(experience_type) WHERE is_active = 1',
];
const EXPERIENCE_COLUMNS = [
    'id',
    'experience_type',
    'responsibility',
    'task_type',
    'decision_domain',
    'situation',
    'trigger',
    'principle',
    'recommended_action',
    'exclusions',
    'evidence',
    'task_retrieval_text',
    'task_embedding',
    'decision_retrieval_text',
    'decision_embedding',
    'embedding_model',
    'embedding_dimension',
    'source_run_id',
    'generation_prompt_id',
    'generation_prompt_version',
    'is_active',
    'created_at',
    'updated_at',
    'retired_at',
    'retired_reason',
    'reactivated_at',
];
/**
 * 经验表：没有版本控制（无历史表、也没有 Active 指针表），状态只有 is_active 两态。
 * 为什么状态放在行上而不是像资产那样用 Active 表：经验没有版本，「活跃」只是
 * 「是否进入召回面」这一个布尔事实，另建一张表等于给单布尔事实造第二处写入边界。
 *
 * 向量两列以 BLOB 存真实数值（Float64 字节序列），维度单独成列：SQLite 无向量类型，
 * 而维度与字节长度互为校验，读侧据此判定一行是否真的可用于语义召回。
 *
 * `experience_type` 的取值域曾在退役 team 类型时收窄（'team' 永久移除），
 * 存量库由 retireTeamExperienceType 重建本表。
 */
function experiencesDdl(tableName) {
    return `
CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','orchestrator')),
  responsibility TEXT NOT NULL,
  task_type TEXT NOT NULL,
  decision_domain TEXT NOT NULL,
  situation TEXT NOT NULL,
  trigger TEXT NOT NULL,
  principle TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  exclusions TEXT NOT NULL CHECK (json_valid(exclusions)),
  evidence TEXT NOT NULL CHECK (json_valid(evidence)),
  task_retrieval_text TEXT NOT NULL,
  task_embedding BLOB,
  decision_retrieval_text TEXT NOT NULL,
  decision_embedding BLOB,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  source_run_id TEXT NOT NULL,
  generation_prompt_id TEXT NOT NULL REFERENCES experience_prompts(id),
  generation_prompt_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- 退役原因/时间与恢复时间：经验没有版本，状态之外还要回答「为什么退出召回面」。
  -- 新增列放在末尾，使 ALTER TABLE 升级后的物理列序与新库一致。
  retired_at INTEGER,
  retired_reason TEXT CHECK (retired_reason IS NULL OR retired_reason IN ('manual','harmful','long_unused')),
  reactivated_at INTEGER
)`;
}
export const EXPERIENCES_DDL = experiencesDdl('experiences');
export const EXPERIENCES_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experiences_type_active ON experiences(experience_type, is_active)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_task_type ON experiences(task_type)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_decision_domain ON experiences(decision_domain)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_source_run ON experiences(source_run_id)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_generation_prompt ON experiences(generation_prompt_id)',
];
/**
 * 使用事实表：一行 = 一次「该经验被显式注入 agent 上下文」。
 *
 * 只有 INSERT / SELECT 两类语句，因此没有 updated_at：历史事实不可变，写入即终态。
 * 为什么带外键：使用事实必须属于真实存在的经验，否则「该主体是否被注入过这条经验」的准入判据
 * 会与经验表脱节（评价准入是 feedback 的唯一防线）。
 */
export const EXPERIENCE_USAGE_DDL = `
CREATE TABLE IF NOT EXISTS experience_usage (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL REFERENCES experiences(id),
  run_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 角色身份由运行时采集（角色资产 id 优先，其次角色名）：用于跨角色长期无用判定与未来角色分析。
  -- 放在末尾，使 ALTER TABLE 升级后的物理列序与新库一致。
  role_key TEXT NOT NULL DEFAULT '',
  role_label TEXT NOT NULL DEFAULT ''
)`;
export const EXPERIENCE_USAGE_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experience_usage_experience ON experience_usage(experience_id)',
    'CREATE INDEX IF NOT EXISTS idx_experience_usage_subject ON experience_usage(subject_id)',
];
/**
 * 评价事实表：四维评分只允许五级锚点，取值约束由数据库保证（TS 联合类型运行期不存在）。
 *
 * 同样只有 INSERT / SELECT：评价历史是统计投影的唯一事实源，一旦允许改写历史，
 * 「改公式后重放历史」（§25）就失去意义。为什么记录评分者主体与模型：为未来的评分者校准留数据
 * （§6.2），V1 不做任何归一化。
 */
export const EXPERIENCE_EVALUATION_DDL = `
CREATE TABLE IF NOT EXISTS experience_evaluation (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL REFERENCES experiences(id),
  run_id TEXT NOT NULL,
  fit_score REAL NOT NULL CHECK(fit_score IN (0,0.25,0.5,0.75,1)),
  decision_effect REAL NOT NULL CHECK(decision_effect IN (-1,-0.5,0,0.5,1)),
  information_gain REAL NOT NULL CHECK(information_gain IN (0,0.25,0.5,0.75,1)),
  causal_confidence REAL NOT NULL CHECK(causal_confidence IN (0,0.25,0.5,0.75,1)),
  evidence TEXT NOT NULL DEFAULT '',
  evaluator_subject_id TEXT NOT NULL,
  evaluator_model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  -- 评分者角色身份（同使用事实口径）：空串表示无角色节点，不参与角色多样性判定。
  role_key TEXT NOT NULL DEFAULT '',
  role_label TEXT NOT NULL DEFAULT ''
)`;
export const EXPERIENCE_EVALUATION_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experience_evaluation_experience ON experience_evaluation(experience_id)',
    'CREATE INDEX IF NOT EXISTS idx_experience_evaluation_created ON experience_evaluation(created_at)',
];
/**
 * 统计投影表：`experience_id` 即主键（每个经验至多一行），全部数值列都是**可重建的派生结果**（§3.2）。
 *
 * 为什么 quality_signal 也要落盘：它是召回修正（§17）的直接输入，读取路径是 getStats；
 * 不落盘就得在读取侧第二次实现 §14 的公式，违反「公式单一本体」。
 * 为什么没有删除精度/级联：经验只有归档没有删除，孤立统计行由 rebuildStats 整表覆盖清除（§24）。
 */
export const EXPERIENCE_STATS_DDL = `
CREATE TABLE IF NOT EXISTS experience_stats (
  experience_id TEXT PRIMARY KEY REFERENCES experiences(id),
  effective_sample_count REAL NOT NULL,
  recalled_count INTEGER NOT NULL,
  used_count INTEGER NOT NULL,
  fit_mean REAL NOT NULL,
  empirical_value REAL NOT NULL,
  variance REAL NOT NULL,
  stability REAL NOT NULL,
  evidence_strength REAL NOT NULL,
  harm_count INTEGER NOT NULL,
  harm_rate REAL NOT NULL,
  harm_severity REAL NOT NULL,
  quality_signal REAL NOT NULL,
  trust REAL NOT NULL,
  updated_at INTEGER NOT NULL
)`;
export const EXPERIENCE_STATS_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experience_stats_trust ON experience_stats(trust)',
    'CREATE INDEX IF NOT EXISTS idx_experience_stats_harm ON experience_stats(harm_rate)',
];
/**
 * 全部建表语句（顺序即依赖顺序：先历史后 Active、先 Prompt 后经验、先经验后评价闭环，
 * 外键才可解析）。评价闭环三表带外键引用 experiences，因此必须排在经验表之后。
 */
export const SCHEMA_STATEMENTS = [
    ROLE_ASSET_HISTORY_DDL,
    ...ROLE_ASSET_HISTORY_INDEXES_DDL,
    WORKFLOW_ASSET_HISTORY_DDL,
    ...WORKFLOW_ASSET_HISTORY_INDEXES_DDL,
    ROLE_ASSET_ACTIVE_DDL,
    ...ROLE_ASSET_ACTIVE_INDEXES_DDL,
    WORKFLOW_ASSET_ACTIVE_DDL,
    ...WORKFLOW_ASSET_ACTIVE_INDEXES_DDL,
    EXPERIENCE_PROMPTS_DDL,
    EXPERIENCES_DDL,
    EXPERIENCE_USAGE_DDL,
    ...EXPERIENCE_USAGE_INDEXES_DDL,
    EXPERIENCE_EVALUATION_DDL,
    ...EXPERIENCE_EVALUATION_INDEXES_DDL,
    EXPERIENCE_STATS_DDL,
    ...EXPERIENCE_STATS_INDEXES_DDL,
];
/**
 * 幂等建表：全部 `IF NOT EXISTS`，重复调用不改变既有库。
 *
 * 经验索引不放进 SCHEMA_STATEMENTS：旧形状的 experiences 还没有 experience_type 列，
 * 先建索引会因「no such column」失败，必须等形状迁移完成后再建。
 *
 * 迁移顺序：
 *   1. 旧形状 experiences 换成带 experience_type 的形状；
 *   2. team 退役迁移在旧形状上删行并收窄 CHECK（提示词表此时仍是旧形状，
 *      用 legacy DDL / 旧列清单重建）；
 *   3. 提示词资产化迁移把旧形状（行上 is_active）升级为「历史版本表 + Active 指针表」，
 *      同时把存量经验行的 generation_prompt_id 映射到新的版本行 id；
 *   4. 最后建 Active 表/索引并保证每个主体类型都有活跃版本——播种排在迁移之后，
 *      退役类型的旧 Prompt 行已删除，不会被重新播种。
 */
export function initSchema(db, now = Date.now) {
    for (const statement of SCHEMA_STATEMENTS)
        db.exec(statement);
    retireJsonSchemaCheck(db);
    migrateLegacyExperienceTable(db);
    migrateExperienceRetirementColumns(db);
    retireTeamExperienceType(db);
    // Active 表必须等旧提示词表升级完成后才能建：旧表没有 (asset_id, version_id) 唯一键
    const legacyActiveVersions = migrateExperiencePromptsToAssets(db);
    db.exec(EXPERIENCE_PROMPT_ACTIVE_DDL);
    for (const statement of EXPERIENCE_PROMPT_ACTIVE_INDEXES_DDL)
        db.exec(statement);
    ensureExperiencePromptAssets(db, now, legacyActiveVersions);
    for (const statement of EXPERIENCE_PROMPTS_INDEXES_DDL)
        db.exec(statement);
    for (const statement of EXPERIENCES_INDEXES_DDL)
        db.exec(statement);
}
/** 重建用的临时表名（只在迁移事务内存在；固定名字便于中断后人工排查）。 */
const ROLE_HISTORY_REBUILD_TABLE = 'role_asset_history__rebuild';
/**
 * 经验退役/角色身份新增列的升级清单（表名与列定义均为本文件静态常量）。
 *
 * 为什么用 ALTER TABLE 而不是换表重建：这些都是「可空列」或「带非空默认值的新列」，
 * 对既有行有确定的兼容语义（退役字段为 NULL、角色身份为空串），换表只会平白引入一次
 * 全表搬运与中断风险；换表重建留给真正需要收窄 CHECK 的迁移（team 退役）。
 *
 * 为什么列定义与 DDL 一样带 CHECK：新增行与新建库必须受同一约束；SQLite 允许
 * ADD COLUMN 携带 CHECK，既有行的 NULL 自然满足约束。
 */
const EXPERIENCE_RETIREMENT_COLUMN_MIGRATIONS = [
    { table: 'experiences', column: 'retired_at', definition: 'INTEGER' },
    {
        table: 'experiences',
        column: 'retired_reason',
        definition: "TEXT CHECK (retired_reason IS NULL OR retired_reason IN ('manual','harmful','long_unused'))",
    },
    { table: 'experiences', column: 'reactivated_at', definition: 'INTEGER' },
    { table: 'experience_usage', column: 'role_key', definition: "TEXT NOT NULL DEFAULT ''" },
    { table: 'experience_usage', column: 'role_label', definition: "TEXT NOT NULL DEFAULT ''" },
    { table: 'experience_evaluation', column: 'role_key', definition: "TEXT NOT NULL DEFAULT ''" },
    { table: 'experience_evaluation', column: 'role_label', definition: "TEXT NOT NULL DEFAULT ''" },
];
/**
 * 旧库补齐退役/角色身份列（幂等）：按 PRAGMA 判断缺列，只加缺的那一列。
 *
 * 顺序必须在 retireTeamExperienceType 之前：team 退役迁移用当前 DDL 重建 experiences，
 * 若旧库还没补列，重建时的列集合校验会因「缺少 retired_*」直接报错。
 */
function migrateExperienceRetirementColumns(db) {
    const pending = EXPERIENCE_RETIREMENT_COLUMN_MIGRATIONS.filter((migration) => !tableColumns(db, migration.table).includes(migration.column));
    if (pending.length === 0)
        return;
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const migration of pending) {
            db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`);
        }
        db.exec('COMMIT');
    }
    catch (error) {
        try {
            db.exec('ROLLBACK');
        }
        catch {
            // SQLite 可能已因错误自动回滚，此处只保证不覆盖原始错误
        }
        throw error;
    }
}
/**
 * 已退役约束的判定文本。
 * 为什么判定表定义原文而不用版本号：既有库可能在任意历史版本被创建且无版本记账，
 * sqlite_master 里的原文是唯一可信事实；判定是幂等的（重建后原文即不再含该文本）。
 */
const RETIRED_INPUT_SCHEMA_CHECK = 'json_valid(input_schema)';
/** 表的列名（按 DDL 声明顺序；PRAGMA 不支持参数绑定，入参只允许本文件的表名常量）。 */
function tableColumns(db, table) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.map((row) => String(row.name));
}
/**
 * 旧形状 experiences 的迁移判定文本。
 * 为什么判定表定义原文而不用版本号：既有库可能在任意历史版本被创建且无版本记账，
 * sqlite_master 里的原文是唯一可信事实；判定是幂等的（重建后原文即含该列名）。
 */
const EXPERIENCE_TYPE_COLUMN = 'experience_type';
/**
 * 旧形状 experiences（无 experience_type 的 insight 单体形状）→ 直接删表重建。
 *
 * 用户裁决：旧经验数据一律删除、不留备份表——旧形状与本形状的字段不是同一套语义
 * （insight/task_context 无法映射到九项语义核心），保留只会留下无人能读的残表。
 *
 * 为什么先关外键：`PRAGMA foreign_keys` 在事务内无效，而删表 + 重建 + 建索引必须整体
 * 原子；关闭期间 DROP 也不会对引用本表的表触发级联删除（与既有资产表重建同范式）。
 *
 * 为什么先清子行再 DROP 父表：experience_usage / experience_evaluation / experience_stats
 * 都以 `experience_id REFERENCES experiences(id)` 引用本表且**没有** ON DELETE CASCADE，
 * 外键关闭期间 DROP 父表不会带走子行，于是旧子行会变成指向不存在经验的孤儿
 * （`PRAGMA foreign_key_check` 报违规、经验统计对已删经验仍然可读）。
 * 旧形状的这三张子表对应的经验已被整体删除，故这里的清理是**无条件全表清理**
 * （没有 experience_type 列可用于限定）。
 *
 * @see retireTeamExperienceType 同类理由的另一处实现（那里按退役类型限定子行）。
 */
function migrateLegacyExperienceTable(db) {
    const definition = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'experiences'")
        .get();
    if (!definition || String(definition.sql ?? '').includes(EXPERIENCE_TYPE_COLUMN))
        return;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
        db.exec('BEGIN IMMEDIATE');
        try {
            // 子行先于父行删除：顺序反了会留下孤儿（外键关闭时不会被拦下）
            db.exec('DELETE FROM experience_usage');
            db.exec('DELETE FROM experience_evaluation');
            db.exec('DELETE FROM experience_stats');
            // 旧索引随表一起消失（DROP TABLE 会带走本表全部索引），无需逐个 DROP INDEX
            db.exec('DROP TABLE experiences');
            db.exec(EXPERIENCES_DDL);
            for (const statement of EXPERIENCES_INDEXES_DDL)
                db.exec(statement);
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // SQLite 可能已因错误自动回滚，此处只保证不覆盖原始错误
            }
            throw error;
        }
    }
    finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
}
/**
 * 已退役主体类型的判定文本。
 *
 * 为什么判定表定义原文而不用版本号：既有库可能在任意历史版本被创建且无版本记账，
 * sqlite_master 里的原文是唯一可信事实；判定是幂等的（重建后原文即不再含 'team'）。
 */
const RETIRED_EXPERIENCE_TYPE = 'team';
/** 重建用的临时表名（只在迁移事务内存在；固定名字便于中断后人工排查）。 */
const EXPERIENCE_PROMPTS_REBUILD_TABLE = 'experience_prompts__rebuild';
const EXPERIENCES_REBUILD_TABLE = 'experiences__rebuild';
/**
 * team 主体类型退役迁移：物理删除存量 team 数据，并把两张表的 CHECK 收窄为两个主体类型。
 *
 * 用户裁决（2026-10-11）：team 类型从架构中永久移除，存量数据真删、不留备份表。
 *
 * 判定为什么看**两张表任一**：真实升级路径上两表可能先后被收窄（旧版本只迁移其中一张、
 * 或人工补过数据），只看 experiences 会让「prompts 表仍是宽 CHECK + 库里还有 team Prompt 行」
 * 的混合态静默留存——磁盘形状没有全部收窄，存量 team 数据也没删干净。
 *
 * 为什么必须重建表而不是只删行：CHECK 是任何写入者（并发写入、外部工具、补数据脚本）
 * 都绕不开的边界，只删行会让这些写入者仍能把 team 行插回来，磁盘形状也就没有真正收窄；
 * SQLite 不支持 DROP CONSTRAINT，因此只能按官方流程换表（参照本文件既有的
 * retireJsonSchemaCheck / role_asset_history 重建范式）。
 *
 * 为什么只重建仍含 'team' 的那张表：已收窄的表再换一次表没有任何收益，只会平白多一次
 * DROP + RENAME 的风险窗口；删除语句则对两张表都执行（对已收窄表无匹配行，幂等且安全）。
 *
 * 为什么先删子行再删父行：experience_usage / experience_evaluation / experience_stats
 * 都以 `experience_id REFERENCES experiences(id)` 引用经验表且没有 ON DELETE CASCADE，
 * 先删父行会留下指向不存在经验的孤儿子行（外键关闭时不会被拦下）。
 *
 * 为什么先关外键：`PRAGMA foreign_keys` 在事务内无效，而删行 + 重建 + 恢复索引
 * 必须整体原子。重建顺序照旧：建同形新表 → 搬数据 → 丢旧表 → 改名回原名。
 */
function retireTeamExperienceType(db) {
    const pending = [
        { table: 'experience_prompts', rebuildTable: EXPERIENCE_PROMPTS_REBUILD_TABLE },
        { table: 'experiences', rebuildTable: EXPERIENCES_REBUILD_TABLE },
    ].filter((entry) => tableDefinitionContains(db, entry.table, RETIRED_EXPERIENCE_TYPE));
    if (pending.length === 0)
        return;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec('PRAGMA legacy_alter_table = ON');
            db.exec(`DELETE FROM experience_usage WHERE experience_id IN (
        SELECT id FROM experiences WHERE experience_type = '${RETIRED_EXPERIENCE_TYPE}'
      )`);
            db.exec(`DELETE FROM experience_evaluation WHERE experience_id IN (
        SELECT id FROM experiences WHERE experience_type = '${RETIRED_EXPERIENCE_TYPE}'
      )`);
            db.exec(`DELETE FROM experience_stats WHERE experience_id IN (
        SELECT id FROM experiences WHERE experience_type = '${RETIRED_EXPERIENCE_TYPE}'
      )`);
            db.exec(`DELETE FROM experiences WHERE experience_type = '${RETIRED_EXPERIENCE_TYPE}'`);
            db.exec(`DELETE FROM experience_prompts WHERE experience_type = '${RETIRED_EXPERIENCE_TYPE}'`);
            for (const entry of pending) {
                rebuildNarrowedTable(db, {
                    table: entry.table,
                    rebuildTable: entry.rebuildTable,
                    ddl: narrowedDdlOf(entry.rebuildTable),
                    insertColumns: expectedColumnsOf(entry.table),
                    indexes: entry.table === 'experience_prompts' ? LEGACY_EXPERIENCE_PROMPTS_INDEXES_DDL : EXPERIENCES_INDEXES_DDL,
                });
            }
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // SQLite 可能已因错误自动回滚，此处只保证不覆盖原始错误
            }
            throw error;
        }
        finally {
            db.exec('PRAGMA legacy_alter_table = OFF');
        }
    }
    finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
}
/**
 * 临时表名 → 该表在**本迁移阶段**的形状。
 *
 * 提示词表此时必须仍按旧形状重建：team 退役迁移只负责收窄主体类型取值域，
 * 资产化（版本号 / Active 指针）排在它之后，由 migrateExperiencePromptsToAssets 单独完成。
 */
function narrowedDdlOf(rebuildTable) {
    if (rebuildTable === EXPERIENCE_PROMPTS_REBUILD_TABLE)
        return legacyExperiencePromptsDdl(rebuildTable);
    if (rebuildTable === EXPERIENCES_REBUILD_TABLE)
        return experiencesDdl(rebuildTable);
    throw new Error(`未知的重建临时表名：${rebuildTable}`);
}
/** 表名 → 该表在本迁移阶段的列清单（只有本文件的表名常量可传入）。 */
function expectedColumnsOf(table) {
    if (table === 'experience_prompts')
        return LEGACY_EXPERIENCE_PROMPT_COLUMNS;
    if (table === 'experiences')
        return EXPERIENCE_COLUMNS;
    throw new Error(`未知的经验表名：${table}`);
}
/**
 * 换表收窄单张表：校验列集合 → 建同形新表 → 只搬合法行 → 丢旧表 → 改名回原名 → 建索引。
 *
 * 为什么先校验列集合：换表只按当前列清单搬迁，旧表多出的列会被**静默丢弃**（被删的列
 * 无从恢复）。列集合不符说明库来自未知形状，宁可报可行动错误也不悄悄删数据，
 * 与 retireJsonSchemaCheck 的列校验同口径。此处抛错时整笔事务尚未提交，调用方回滚后
 * 库保持原状（错误信息里也写明这点，避免使用者误以为已迁移成功）。
 *
 * 为什么用显式列名而不是 `SELECT *`：新旧形状的列集合本应一致，但列序一旦不同，`SELECT *`
 * 会把值搬错列且不报错（迁移最危险的静默失败）；逐列列出后，任何列序漂移都会立即报错。
 * 搬迁条件再挡一层退役取值，即使前面的 DELETE 因未知形状漏掉行，违规行也进不了新表。
 *
 * 为什么开 legacy_alter_table：默认改名会连带改写其它表定义里对该表的引用，
 * 关掉它才能让 experience_usage 等表的外键继续指向重建后的同名表（与既有重建同范式）。
 */
function rebuildNarrowedTable(db, rebuild) {
    const previous = tableColumns(db, rebuild.table);
    const expected = [...rebuild.insertColumns];
    const missing = expected.filter((column) => !previous.includes(column));
    const unexpected = previous.filter((column) => !expected.includes(column));
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(`${rebuild.table} 列集合与当前形状不符（缺少：${missing.join('、') || '无'}；多出：${unexpected.join('、') || '无'}）。请备份后人工迁移；本次初始化未提交任何改动，库保持原状`);
    }
    const columns = expected.join(', ');
    db.exec(rebuild.ddl);
    db.exec(`INSERT INTO ${rebuild.rebuildTable} (${columns}) SELECT ${columns} FROM ${rebuild.table}
      WHERE experience_type <> '${RETIRED_EXPERIENCE_TYPE}'`);
    // 旧索引随旧表一起消失（DROP TABLE 会带走本表全部索引）
    db.exec(`DROP TABLE ${rebuild.table}`);
    db.exec(`ALTER TABLE ${rebuild.rebuildTable} RENAME TO ${rebuild.table}`);
    for (const statement of rebuild.indexes)
        db.exec(statement);
}
/**
 * 表定义原文是否含判定文本。
 * 为什么读 sqlite_master 而不是 PRAGMA：PRAGMA 给不出 CHECK 表达式原文，
 * 而「取值域是否已收窄」只能从建表语句本身判断。
 */
function tableDefinitionContains(db, table, text) {
    const definition = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
    return Boolean(definition) && String(definition?.sql ?? '').includes(text);
}
/** 提示词资产化迁移的临时表名（只在迁移事务内存在；固定名字便于中断后人工排查）。 */
const EXPERIENCE_PROMPTS_ASSET_REBUILD_TABLE = 'experience_prompts__asset_rebuild';
/** 提示词主体类型（与 DDL CHECK 同域；迁移只处理这两类，team 已由前序迁移删除）。 */
const PROMPT_EXPERIENCE_TYPES = ['agent', 'orchestrator'];
/** 表是否存在（迁移判定用；表名只允许本文件常量）。 */
function tableExists(db, table) {
    const row = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return row !== undefined;
}
/**
 * 提示词旧形状（行上 is_active）→ 「历史版本表 + Active 指针表」。
 *
 * 用户裁决（2026-10-19）：
 *   - 旧行**全部保留**为历史版本，不丢弃任何用户改写过的正文；
 *   - 原 is_active=1 的行成为 Active 指针；若某类型没有活跃行，取版本号最大的行——
 *     提示词资产禁止归档，Active 指针因此必须始终存在；
 *   - 版本号按 created_at、id 升序重新编号，版本行 id 统一为 `<assetId>@<versionId>`；
 *   - 存量经验行的 generation_prompt_id 同步映射到新版本行 id，版本文本原样保留，
 *     使历史经验继续指向「生成时使用的那一版正文」。
 *
 * 为什么必须换表：旧形状没有 asset_id / version_id，也没有 Active 指针；
 * 只有把版本事实与指针拆开，提示词才能与工作流/角色资产共享同一套版本语义。
 *
 * @returns 每个提示词资产迁移后的活跃版本号（交给 ensureExperiencePromptAssets 建指针）；
 *          库已是新形状时返回 null。
 */
function migrateExperiencePromptsToAssets(db) {
    if (!tableExists(db, 'experience_prompts'))
        return null;
    const columns = tableColumns(db, 'experience_prompts');
    if (columns.includes('asset_id') && columns.includes('version_id'))
        return null;
    const expected = LEGACY_EXPERIENCE_PROMPT_COLUMNS;
    const missing = expected.filter((column) => !columns.includes(column));
    const unexpected = columns.filter((column) => !expected.includes(column));
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(`experience_prompts 列集合与旧形状不符（缺少：${missing.join('、') || '无'}；多出：${unexpected.join('、') || '无'}）。请备份后人工迁移；本次初始化未提交任何改动，库保持原状`);
    }
    const rawRows = db
        .prepare(`SELECT id, experience_type, name, description, prompt, prompt_version, is_active, created_at
         FROM experience_prompts`)
        .all();
    const rowsByType = new Map();
    for (const raw of rawRows) {
        const type = String(raw.experience_type ?? '');
        if (!PROMPT_EXPERIENCE_TYPES.includes(type)) {
            // 前序 team 退役迁移应已删除 team 行；其余未知取值没有可归属的资产，保留告警后跳过
            console.warn(`[assets] 提示词迁移跳过未知主体类型 ${type}（行 ${String(raw.id)}）`);
            continue;
        }
        const row = {
            id: String(raw.id),
            experienceType: type,
            name: String(raw.name ?? ''),
            description: raw.description === null || raw.description === undefined ? null : String(raw.description),
            prompt: String(raw.prompt ?? ''),
            promptVersion: String(raw.prompt_version ?? ''),
            isActive: Number(raw.is_active ?? 0) !== 0,
            createdAt: Number(raw.created_at ?? 0),
        };
        const list = rowsByType.get(row.experienceType) ?? [];
        list.push(row);
        rowsByType.set(row.experienceType, list);
    }
    const activeVersions = new Map();
    const idMap = new Map();
    const ordered = [];
    for (const type of PROMPT_EXPERIENCE_TYPES) {
        const rows = (rowsByType.get(type) ?? []).sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        if (rows.length === 0)
            continue;
        const assetId = EXPERIENCE_PROMPT_ASSET_IDS[type];
        rows.forEach((row, index) => {
            const versionId = index + 1;
            const rowId = versionRowId(assetId, versionId);
            ordered.push({ row, assetId, versionId, rowId });
            idMap.set(row.id, rowId);
        });
        const activeRows = rows.filter((row) => row.isActive);
        const activeRow = activeRows.length > 0 ? activeRows[activeRows.length - 1] : rows[rows.length - 1];
        activeVersions.set(assetId, rows.indexOf(activeRow) + 1);
    }
    const experiencesExist = tableExists(db, 'experiences');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec('PRAGMA legacy_alter_table = ON');
            // 半迁移态可能残留 Active 表：旧表重建后指针必须重新生成，先整体丢弃
            db.exec('DROP TABLE IF EXISTS experience_prompt_active');
            db.exec(experiencePromptsDdl(EXPERIENCE_PROMPTS_ASSET_REBUILD_TABLE));
            const insert = db.prepare(`INSERT INTO ${EXPERIENCE_PROMPTS_ASSET_REBUILD_TABLE} (
           id, version_id, asset_id, experience_type, name, description, prompt, prompt_version, source, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human', ?)`);
            for (const entry of ordered) {
                insert.run(entry.rowId, entry.versionId, entry.assetId, entry.row.experienceType, entry.row.name, entry.row.description, entry.row.prompt, entry.row.promptVersion === '' ? `V${entry.versionId}` : entry.row.promptVersion, entry.row.createdAt);
            }
            if (experiencesExist) {
                const update = db.prepare('UPDATE experiences SET generation_prompt_id = ? WHERE generation_prompt_id = ?');
                for (const [oldId, newId] of idMap)
                    update.run(newId, oldId);
            }
            db.exec('DROP TABLE experience_prompts');
            db.exec(`ALTER TABLE ${EXPERIENCE_PROMPTS_ASSET_REBUILD_TABLE} RENAME TO experience_prompts`);
            for (const statement of EXPERIENCE_PROMPTS_INDEXES_DDL)
                db.exec(statement);
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // SQLite 可能已因错误自动回滚，此处只保证不覆盖原始错误
            }
            throw error;
        }
        finally {
            db.exec('PRAGMA legacy_alter_table = OFF');
        }
    }
    finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
    return activeVersions;
}
/**
 * 保证每个提示词资产都有活跃版本（初始化时执行，幂等）。
 *
 * 判定与播种口径：
 *   - 某资产没有任何历史行 → 播种内置 V1（含版本行与 Active 行）；
 *   - 有历史行但 Active 行缺失或指向不存在的版本 → 优先取迁移记录的原活跃版本，
 *     否则取最新版本（`version_id` 最大）；这正是「指针必须保持活跃」的兜底；
 *   - Active 行有效 → 一律不动，因此用户改写的正文不会被初始化覆盖。
 */
function ensureExperiencePromptAssets(db, now, legacyActiveVersions) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const historyOf = db.prepare('SELECT version_id, name FROM experience_prompts WHERE asset_id = ? ORDER BY version_id DESC');
        const activeOf = db.prepare('SELECT version_id FROM experience_prompt_active WHERE asset_id = ?');
        const deleteActive = db.prepare('DELETE FROM experience_prompt_active WHERE asset_id = ?');
        const insertActive = db.prepare(`INSERT INTO experience_prompt_active (asset_id, version_id, experience_type, name, updated_at)
       VALUES (?, ?, ?, ?, ?)`);
        const insertVersion = db.prepare(`INSERT INTO experience_prompts (
         id, version_id, asset_id, experience_type, name, description, prompt, prompt_version, source, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human', ?)`);
        for (const seed of EXPERIENCE_PROMPT_SEEDS) {
            const history = historyOf.all(seed.assetId);
            if (history.length === 0) {
                const at = now();
                insertVersion.run(versionRowId(seed.assetId, 1), 1, seed.assetId, seed.experienceType, seed.name, seed.description, seed.prompt, seed.promptVersion, at);
                insertActive.run(seed.assetId, 1, seed.experienceType, seed.name, at);
                continue;
            }
            const active = activeOf.get(seed.assetId);
            const activeVersion = active ? Number(active.version_id) : null;
            if (activeVersion !== null && history.some((row) => Number(row.version_id) === activeVersion))
                continue;
            const preferred = legacyActiveVersions?.get(seed.assetId);
            const chosen = preferred !== undefined && history.some((row) => Number(row.version_id) === preferred)
                ? preferred
                : Number(history[0].version_id);
            const chosenName = String(history.find((row) => Number(row.version_id) === chosen)?.name ?? seed.name);
            deleteActive.run(seed.assetId);
            insertActive.run(seed.assetId, chosen, seed.experienceType, chosenName, now());
        }
        db.exec('COMMIT');
    }
    catch (error) {
        try {
            db.exec('ROLLBACK');
        }
        catch {
            // 同上：不覆盖原始错误
        }
        throw error;
    }
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
function retireJsonSchemaCheck(db) {
    const definition = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'role_asset_history'")
        .get();
    if (!definition || !String(definition.sql ?? '').includes(RETIRED_INPUT_SCHEMA_CHECK))
        return;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec('PRAGMA legacy_alter_table = ON');
            db.exec(roleAssetHistoryDdl(ROLE_HISTORY_REBUILD_TABLE));
            // 重建只退役约束、不改列集合；列序不一致说明库来自未知形状，宁可报错也不搬错数据
            const previous = tableColumns(db, 'role_asset_history').join(',');
            const rebuilt = tableColumns(db, ROLE_HISTORY_REBUILD_TABLE).join(',');
            if (previous !== rebuilt) {
                throw new Error(`资产库 role_asset_history 列集合与当前形状不符（库中：${previous}），请备份后人工迁移`);
            }
            db.exec(`INSERT INTO ${ROLE_HISTORY_REBUILD_TABLE} SELECT * FROM role_asset_history`);
            db.exec('DROP TABLE role_asset_history');
            db.exec(`ALTER TABLE ${ROLE_HISTORY_REBUILD_TABLE} RENAME TO role_asset_history`);
            for (const statement of ROLE_ASSET_HISTORY_INDEXES_DDL)
                db.exec(statement);
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // 事务可能已被 SQLite 因错误自动回滚，此处只保证不覆盖原始错误
            }
            throw error;
        }
        finally {
            db.exec('PRAGMA legacy_alter_table = OFF');
        }
    }
    finally {
        db.exec('PRAGMA foreign_keys = ON');
    }
}
//# sourceMappingURL=schema.js.map