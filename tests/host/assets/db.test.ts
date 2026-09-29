// tests/host/assets/db.test.ts
//
// 资产库初始化契约：库文件位置、建表幂等、跨连接可见（重开不丢数据）、关闭后的行为，
// 以及存量库的形状迁移（退役 input_schema / output_schema 的 json_valid 约束、
// 为经验表补 is_active 状态列）。

import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASSET_DB_FILE, AssetStore } from '../../../src/host/assets/index.js'
import { fakeClock, fakeIds, makeStore, removeTempRoot, roleTemplate } from './fixtures/asset-fixture.js'

/**
 * 迁移前的历史表形状（冻结副本：迁移用例必须固定旧形状，不能跟着 src 漂移，
 * 否则「旧库能否升级」这条契约会随源码改动自动变成恒真）。
 */
const LEGACY_ROLE_HISTORY_DDL = `
CREATE TABLE role_asset_history (
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
  input_schema TEXT CHECK (input_schema IS NULL OR json_valid(input_schema)),
  output_schema TEXT CHECK (output_schema IS NULL OR json_valid(output_schema)),
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

/** 历史表的旧索引与以它为父表的外键表（重建后都必须仍然可用）。 */
const LEGACY_SUPPORT_DDL = [
  'CREATE INDEX idx_role_history_asset_id ON role_asset_history(asset_id)',
  'CREATE INDEX idx_role_history_status ON role_asset_history(reference_status)',
  `CREATE TABLE role_asset_active (
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
   )`,
  `INSERT INTO role_asset_history (
     id, version_id, asset_id, kind, name, system_prompt, provider, model, reasoning, preset_id,
     retry_limit, react_limit, input_schema, output_schema, system_prompt_source,
     inject_system_prompt, inject_tool_sections, prompt_file_path, retrieval_context,
     role_asset_type, reference_status, reference_workflow_ids, source, source_template_id,
     source_fingerprint, created_at, updated_at
   ) VALUES (
     'role-legacy1@1', 1, 'role-legacy1', 'agent', '旧角色', '旧提示词', 'deepseek', 'deepseek-chat', '', '',
     2, NULL, '{"type":"object"}', NULL, NULL,
     1, 1, NULL, 'role-legacy1 旧角色',
     'standalone', 'unused', '[]', 'human', 'tpl-legacy',
     'fp-legacy', 1000, 1000
   )`,
  `INSERT INTO role_asset_active (asset_id, version_id, name, retrieval_context, source_template_id, source_fingerprint, updated_at)
   VALUES ('role-legacy1', 1, '旧角色', 'role-legacy1 旧角色', 'tpl-legacy', 'fp-legacy', 1000)`,
]

/** 建一个旧形状的资产库（调用方负责清理目录）。 */
async function makeLegacyStore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-legacy-'))
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(root, ASSET_DB_FILE))
  try {
    db.exec(LEGACY_ROLE_HISTORY_DDL)
    for (const statement of LEGACY_SUPPORT_DDL) db.exec(statement)
  } finally {
    db.close()
  }
  return root
}

/**
 * 迁移前的经验表形状（冻结副本：早期版本没有 is_active 列，直接查该列会报 no such column）。
 * 同样固定旧 DDL，避免「旧库能否升级」随源码漂移成恒真。
 */
const LEGACY_EXPERIENCES_DDL = `
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  source_run_id TEXT,
  reflection_prompt_version TEXT NOT NULL DEFAULT '1',
  task_type TEXT NOT NULL,
  task_context TEXT NOT NULL,
  insight TEXT NOT NULL,
  evidence TEXT,
  review_feedback TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const LEGACY_EXPERIENCE_ROW = `INSERT INTO experiences (
    id, source_run_id, reflection_prompt_version, task_type, task_context, insight, evidence,
    review_feedback, reviewed_at, created_at, updated_at
  ) VALUES ('ex-legacy1', NULL, '1', '软件开发', '旧的上下文', '旧的经验', '旧证据', NULL, 1000, 1000, 1000)`

/** 建一个旧形状的经验库（只有旧 experiences 表；其余表由 init 幂等补齐）。 */
async function makeLegacyExperienceStore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-legacy-exp-'))
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(root, ASSET_DB_FILE))
  try {
    db.exec(LEGACY_EXPERIENCES_DDL)
    db.exec(LEGACY_EXPERIENCE_ROW)
  } finally {
    db.close()
  }
  return root
}

let store: AssetStore
let root: string

beforeEach(async () => {
  const created = await makeStore()
  store = created.store
  root = created.root
})

afterEach(async () => {
  store.close()
  await removeTempRoot(root)
})

describe('初始化', () => {
  it('test_初始化_库文件固定落在root下assets_db', () => {
    expect(existsSync(join(root, ASSET_DB_FILE))).toBe(true)
  })

  it('test_初始化_重复调用_幂等且不影响既有数据', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    await store.init()
    await store.init()

    const detail = await store.getRoleAsset(promoted.assetId)
    expect(detail?.versionId).toBe(1)
    expect(await store.listRoleVersions(promoted.assetId)).toHaveLength(1)
  })

  it('test_重建store_同一库文件_数据仍在', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    store.close()

    const reopened = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    await reopened.init()
    try {
      const detail = await reopened.getRoleAsset(promoted.assetId)
      expect(detail?.name).toBe('研究员')
      expect(detail?.rowId).toBe(promoted.rowId)
    } finally {
      reopened.close()
    }
  })

  it('test_未初始化_写操作_给出可行动错误', async () => {
    const fresh = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    await expect(
      fresh.promoteRole({ templateId: 'tpl-1', fingerprint: 'fp-1', role: roleTemplate(), source: 'human' }),
    ).rejects.toThrow(/尚未初始化/)
  })
})

describe('存量库形状迁移（交接契约列的 JSON 约束退役）', () => {
  it('test_初始化_旧库带json_valid约束_退役约束且数据索引外键均保留', async () => {
    const legacyRoot = await makeLegacyStore()
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()

      const { DatabaseSync } = await import('node:sqlite')
      const raw = new DatabaseSync(join(legacyRoot, ASSET_DB_FILE))
      let tableSql = ''
      let activeSql = ''
      let namedIndexes: string[] = []
      let rebuildLeftover: unknown
      let foreignKeyViolations: unknown[] = []
      try {
        tableSql = String((raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='role_asset_history'").get() as Record<string, unknown>).sql)
        activeSql = String((raw.prepare("SELECT sql FROM sqlite_master WHERE name='role_asset_active'").get() as Record<string, unknown>).sql)
        namedIndexes = raw
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='role_asset_history' AND name NOT LIKE 'sqlite_autoindex%'")
          .all()
          .map((row) => String((row as Record<string, unknown>).name))
          .sort()
        rebuildLeftover = raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'role_asset_history__rebuild%'").get()
        foreignKeyViolations = raw.prepare('PRAGMA foreign_key_check').all()
      } finally {
        raw.close()
      }

      // 约束退役 + 重建的表仍是同一张（列形状不变）、索引与外键引用完好、无临时表残留
      expect(tableSql).not.toContain('json_valid(input_schema)')
      expect(tableSql).not.toContain('json_valid(output_schema)')
      expect(tableSql).toContain('UNIQUE(asset_id, version_id)')
      expect(activeSql).toContain('REFERENCES role_asset_history')
      expect(namedIndexes).toEqual(['idx_role_history_asset_id', 'idx_role_history_status'])
      expect(rebuildLeftover).toBeUndefined()
      expect(foreignKeyViolations).toEqual([])

      // 旧数据原样保留，并可按新语义继续写入自由文本
      const detail = await migrated.getRoleAsset('role-legacy1')
      expect(detail).toMatchObject({
        assetId: 'role-legacy1',
        versionId: 1,
        name: '旧角色',
        systemPrompt: '旧提示词',
        inputSchema: '{"type":"object"}',
        sourceTemplateId: 'tpl-legacy',
      })

      const saved = await migrated.saveRoleVersion({
        assetId: 'role-legacy1',
        role: roleTemplate({ name: '旧角色', systemPrompt: '新提示词', inputSchema: '上游结论；产出文件路径列表', outputSchema: '结论；关键决策' }),
        source: 'human',
      })
      expect(saved.versionId).toBe(2)
      expect((await migrated.getRoleAsset('role-legacy1'))?.inputSchema).toBe('上游结论；产出文件路径列表')
    } finally {
      migrated.close()
      await removeTempRoot(legacyRoot)
    }
  })

  it('test_初始化_已是新形状_不重建且既有版本号不重置', async () => {
    // 同一形状重复初始化：迁移判定幂等，第二次不得再换表（换表会丢 Active 之外的统计写入）
    await store.init()
    await store.init()

    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(join(root, ASSET_DB_FILE))
    try {
      const table = raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='role_asset_history'").get() as Record<string, unknown>
      expect(String(table.sql)).not.toContain('json_valid(input_schema)')
      expect(raw.prepare("SELECT COUNT(*) AS total FROM role_asset_history").get()).toMatchObject({ total: 0 })
    } finally {
      raw.close()
    }
  })
})

describe('存量库形状迁移（经验表补 is_active 状态列）', () => {
  it('test_初始化_旧经验表无is_active_补列且旧数据读为活跃并可归档', async () => {
    const legacyRoot = await makeLegacyExperienceStore()
    const migrated = new AssetStore(legacyRoot, { now: fakeClock(), ids: fakeIds() })
    try {
      await migrated.init()

      const { DatabaseSync } = await import('node:sqlite')
      const raw = new DatabaseSync(join(legacyRoot, ASSET_DB_FILE))
      let columns: string[] = []
      let indexNames: string[] = []
      try {
        columns = (raw.prepare('PRAGMA table_info(experiences)').all() as Record<string, unknown>[]).map((row) => String(row.name))
        indexNames = (raw
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='experiences'")
          .all() as Record<string, unknown>[]).map((row) => String(row.name))
      } finally {
        raw.close()
      }

      expect(columns).toContain('is_active')
      expect(indexNames).toContain('idx_experiences_active')

      // 旧数据按「入库即生效」读成活跃：召回面与界面列表都能看到它
      const [entry] = await migrated.listExperiences(10)
      expect(entry).toMatchObject({ id: 'ex-legacy1', active: true, insight: '旧的经验', evidence: '旧证据' })
      expect((await migrated.listExperienceIndex(10)).map((item) => item.id)).toEqual(['ex-legacy1'])

      // 补列之后状态切换可用（这是旧库升级后新增的能力）
      const retired = await migrated.setExperienceActive('ex-legacy1', false)
      expect(retired.active).toBe(false)
      expect(await migrated.listExperienceIndex(10)).toEqual([])
      expect(await migrated.getExperiences(['ex-legacy1'])).toEqual([])
    } finally {
      migrated.close()
      await removeTempRoot(legacyRoot)
    }
  })

  it('test_初始化_已是新形状经验表_重复初始化幂等且数据不丢', async () => {
    const inserted = await store.insertExperiences([{ taskType: '软件开发', taskContext: '上下文', insight: '经验' }], 1)
    await store.setExperienceActive(inserted.inserted[0].id, false)

    await store.init()
    await store.init()

    const [entry] = await store.listExperiences(10)
    expect(entry.id).toBe(inserted.inserted[0].id)
    expect(entry.active).toBe(false)
  })
})
