// tests/host/assets/experience-prompt-assets.test.ts
//
// 经验生成提示词资产的持久化契约：
// - 两款内置提示词各是一条逻辑资产，Active 指针必须始终存在（不可归档）；
// - 版本与其他资产同构：历史行不可变、保存只追加版本并移动 Active、回滚只移动指针；
// - 只有正文可编辑，名称 / 描述 / 主体类型由内置定义固定；
// - 经验 provenance 继续用 generation_prompt_id（版本行 id）与 generation_prompt_version（版本文本）对接。

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AssetStore,
  EXPERIENCE_PROMPT_SEEDS,
  EXPERIENCE_PROMPT_SEED_VERSION,
} from '../../../src/host/assets/index.js'
import { EXPERIENCES_DDL, initSchema } from '../../../src/host/assets/schema.js'
import { experienceRow, keepAllJudge, makeStore, openRawDb, rawQuery, removeTempRoot } from './fixtures/asset-fixture.js'

/** 冻结的「提示词资产化之前」表形状（仅 agent/orchestrator，聚焦提示词迁移本身）。 */
const LEGACY_PROMPTS_DDL = `
CREATE TABLE experience_prompts (
  id TEXT PRIMARY KEY,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('agent','orchestrator')),
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

/** 旧库的 Prompt 行：agent 有归档旧版 + 活跃新版；orchestrator 只有一条非活跃行。 */
const LEGACY_PROMPT_ROWS = [
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-agent-v0', 'agent', 'Agent Experience Generation Prompt', '旧描述', '旧版 agent 正文', 'V0', 0, 900, 900)`,
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-agent-v1', 'agent', 'Agent Experience Generation Prompt', '当前描述', '当前 agent 正文', 'V1', 1, 1000, 1000)`,
  `INSERT INTO experience_prompts (id, experience_type, name, description, prompt, prompt_version, is_active, created_at, updated_at)
     VALUES ('ep-orchestrator-v1', 'orchestrator', 'Orchestration Experience Generation Prompt', '编排描述', '编排正文', 'V1', 0, 1100, 1100)`,
]

/** 一条引用旧 Prompt 行的经验（迁移后 provenance 必须继续指向同一内容版本）。 */
const LEGACY_EXPERIENCE_INSERT = `INSERT INTO experiences (
  id, experience_type, responsibility, task_type, decision_domain, situation, trigger,
  principle, recommended_action, exclusions, evidence, task_retrieval_text,
  decision_retrieval_text, source_run_id, generation_prompt_id, generation_prompt_version,
  is_active, created_at, updated_at
) VALUES (
  'ex-legacy', 'agent', '职责', '软件开发', '决策域', '情境', '触发', '原则', '行动',
  '[]', '[]', '任务侧', '决策侧', 'run-1', 'ep-agent-v1', 'V1', 1, 1000, 1000
)`

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

/** 构造「提示词尚未资产化」的旧库（其余表为当前形状，便于验证经验引用迁移）。 */
async function makeLegacyPromptRoot(): Promise<string> {
  const legacyRoot = await mkdtemp(join(tmpdir(), 'dsh-assets-legacy-prompts-'))
  const raw = await openRawDb(legacyRoot)
  try {
    initSchema(raw, () => 1000)
    raw.exec('PRAGMA foreign_keys = OFF')
    try {
      raw.exec('DROP TABLE experience_prompt_active')
      raw.exec('DROP TABLE experiences')
      raw.exec('DROP TABLE experience_prompts')
      raw.exec(LEGACY_PROMPTS_DDL)
      raw.exec(EXPERIENCES_DDL)
      for (const statement of LEGACY_PROMPT_ROWS) raw.exec(statement)
      raw.exec(LEGACY_EXPERIENCE_INSERT)
    } finally {
      raw.exec('PRAGMA foreign_keys = ON')
    }
  } finally {
    raw.close()
  }
  return legacyRoot
}

describe('提示词资产初始化与播种', () => {
  it('test_初始化_两类主体各一条提示词资产且Active指针存在', async () => {
    const assets = await store.listPromptAssets()

    expect(assets.map((item) => item.experienceType).sort()).toEqual(['agent', 'orchestrator'])
    expect(assets.every((item) => item.versionId === 1)).toBe(true)
    expect(assets.every((item) => item.promptVersion === EXPERIENCE_PROMPT_SEED_VERSION)).toBe(true)
    for (const seed of EXPERIENCE_PROMPT_SEEDS) {
      const stored = assets.find((item) => item.assetId === seed.assetId)
      expect(stored).toMatchObject({
        name: seed.name,
        description: seed.description,
        prompt: seed.prompt,
      })
    }

    const activeRows = await rawQuery(root, 'SELECT asset_id, version_id, experience_type FROM experience_prompt_active ORDER BY asset_id')
    expect(activeRows).toEqual([
      { asset_id: 'ep-agent', version_id: 1, experience_type: 'agent' },
      { asset_id: 'ep-orchestrator', version_id: 1, experience_type: 'orchestrator' },
    ])
  })

  it('test_读取活跃生成提示词_返回版本行id与版本文本供经验对接', async () => {
    const agent = await store.getActivePrompt('agent')
    const orchestrator = await store.getActivePrompt('orchestrator')

    expect(agent).toMatchObject({
      id: 'ep-agent@1',
      experienceType: 'agent',
      promptVersion: 'V1',
      active: true,
    })
    expect(orchestrator?.id).toBe('ep-orchestrator@1')
  })
})

describe('提示词资产版本控制（只有正文可编辑）', () => {
  it('test_保存新版本_只改正文并保留名称与描述', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!
    const result = await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '用户改写后的正文' })

    expect(result).toMatchObject({
      assetId: seed.assetId,
      versionId: 2,
      rowId: 'ep-agent@2',
      unchanged: false,
    })
    const detail = await store.getPromptAsset(seed.assetId)
    expect(detail).toMatchObject({
      versionId: 2,
      rowId: 'ep-agent@2',
      name: seed.name,
      description: seed.description,
      prompt: '用户改写后的正文',
      promptVersion: 'V2',
    })

    // 历史行不可变：v1 仍是内置正文
    const versions = await rawQuery(
      root,
      'SELECT id, version_id, prompt FROM experience_prompts WHERE asset_id = ? ORDER BY version_id',
      [seed.assetId],
    )
    expect(versions).toEqual([
      { id: 'ep-agent@1', version_id: 1, prompt: seed.prompt },
      { id: 'ep-agent@2', version_id: 2, prompt: '用户改写后的正文' },
    ])
  })

  it('test_保存相同正文_不新增版本', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!
    const first = await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '相同正文' })
    const second = await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '相同正文' })

    expect(first.unchanged).toBe(false)
    expect(second).toMatchObject({ versionId: 2, rowId: 'ep-agent@2', unchanged: true })
    const rows = await rawQuery(root, 'SELECT COUNT(*) AS total FROM experience_prompts WHERE asset_id = ?', [seed.assetId])
    expect(rows[0]).toMatchObject({ total: 2 })
  })

  it('test_保存空正文_被拒绝且不产生版本', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!

    await expect(store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '   ' })).rejects.toMatchObject({
      code: 'WF_ASSET_BAD_ARGS',
    })
    const rows = await rawQuery(root, 'SELECT COUNT(*) AS total FROM experience_prompts WHERE asset_id = ?', [seed.assetId])
    expect(rows[0]).toMatchObject({ total: 1 })
  })

  it('test_回滚_只移动Active指针且不新增版本', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!
    await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '第二版正文' })

    const detail = await store.rollbackPromptAsset(seed.assetId, 1)

    expect(detail).toMatchObject({ versionId: 1, rowId: 'ep-agent@1', prompt: seed.prompt, promptVersion: 'V1' })
    const active = await store.getActivePrompt('agent')
    expect(active).toMatchObject({ id: 'ep-agent@1', promptVersion: 'V1' })
    const rows = await rawQuery(root, 'SELECT COUNT(*) AS total FROM experience_prompts WHERE asset_id = ?', [seed.assetId])
    expect(rows[0]).toMatchObject({ total: 2 })
  })

  it('test_版本列表_标明当前Active版本', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!
    await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '第二版正文' })

    const versions = await store.listPromptVersions(seed.assetId)

    expect(versions).toEqual([
      { versionId: 2, rowId: 'ep-agent@2', name: seed.name, createdAt: expect.any(Number), source: 'human', active: true },
      { versionId: 1, rowId: 'ep-agent@1', name: seed.name, createdAt: expect.any(Number), source: 'human', active: false },
    ])
  })

  it('test_初始化自愈_Active行被外部删除后取最新版本恢复', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!
    await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '第二版正文' })
    const raw = await openRawDb(root)
    try {
      raw.exec(`DELETE FROM experience_prompt_active WHERE asset_id = '${seed.assetId}'`)
    } finally {
      raw.close()
    }
    store.close()

    const reopened = new AssetStore(root, { now: () => 5000, ids: { random: () => 0, sequence: () => 1 } })
    try {
      await reopened.init()
      expect(await reopened.getActivePrompt('agent')).toMatchObject({ id: 'ep-agent@2', promptVersion: 'V2' })
    } finally {
      reopened.close()
    }
  })
})

describe('提示词旧数据迁移', () => {
  it('test_迁移_全部旧行成为历史版本_原活跃行为Active_无活跃行取最新版', async () => {
    const legacyRoot = await makeLegacyPromptRoot()
    const migrated = new AssetStore(legacyRoot, { now: () => 5000, ids: { random: () => 0, sequence: () => 1 } })
    try {
      await migrated.init()

      const assets = await migrated.listPromptAssets()
      expect(assets.find((item) => item.experienceType === 'agent')).toMatchObject({
        versionId: 2,
        prompt: '当前 agent 正文',
        promptVersion: 'V1',
        name: 'Agent Experience Generation Prompt',
      })
      // orchestrator 旧库没有活跃行：Active 必须取最新版本，不能悬空
      expect(assets.find((item) => item.experienceType === 'orchestrator')).toMatchObject({
        versionId: 1,
        prompt: '编排正文',
      })

      const promptRows = await rawQuery(
        legacyRoot,
        'SELECT id, version_id, asset_id, experience_type, prompt, prompt_version FROM experience_prompts ORDER BY asset_id, version_id',
      )
      expect(promptRows).toEqual([
        { id: 'ep-agent@1', version_id: 1, asset_id: 'ep-agent', experience_type: 'agent', prompt: '旧版 agent 正文', prompt_version: 'V0' },
        { id: 'ep-agent@2', version_id: 2, asset_id: 'ep-agent', experience_type: 'agent', prompt: '当前 agent 正文', prompt_version: 'V1' },
        { id: 'ep-orchestrator@1', version_id: 1, asset_id: 'ep-orchestrator', experience_type: 'orchestrator', prompt: '编排正文', prompt_version: 'V1' },
      ])

      // 经验 provenance：id 必须指向迁移后的同一内容版本，版本文本保持不变
      const experiences = await rawQuery(
        legacyRoot,
        'SELECT id, generation_prompt_id, generation_prompt_version FROM experiences ORDER BY id',
      )
      expect(experiences).toEqual([
        { id: 'ex-legacy', generation_prompt_id: 'ep-agent@2', generation_prompt_version: 'V1' },
      ])
    } finally {
      migrated.close()
      await removeTempRoot(legacyRoot)
    }
  })

  it('test_迁移后重新初始化_不覆盖用户改写正文且不重复播种', async () => {
    const legacyRoot = await makeLegacyPromptRoot()
    const migrated = new AssetStore(legacyRoot, { now: () => 5000, ids: { random: () => 0, sequence: () => 1 } })
    try {
      await migrated.init()
      await migrated.init()
      const agent = (await migrated.listPromptAssets()).find((item) => item.experienceType === 'agent')
      expect(agent?.prompt).toBe('当前 agent 正文')
      const rows = await rawQuery(legacyRoot, 'SELECT COUNT(*) AS total FROM experience_prompts')
      expect(rows[0]).toMatchObject({ total: 3 })
    } finally {
      migrated.close()
      await removeTempRoot(legacyRoot)
    }
  })
})

describe('提示词与经验协同的版本记录', () => {
  it('test_新经验记录当前活跃版本_回滚后新经验记录旧版本而历史经验不变', async () => {
    const seed = EXPERIENCE_PROMPT_SEEDS.find((item) => item.experienceType === 'agent')!
    const v1 = await store.getActivePrompt('agent')
    expect(v1).not.toBeNull()
    await store.insertChecked({
      rows: [
        experienceRow('ex-v1', {
          generationPromptId: v1!.id,
          generationPromptVersion: v1!.promptVersion,
          decisionRetrievalText: '第一版生成的经验',
        }),
      ],
      duplicateOf: keepAllJudge,
    })

    await store.savePromptAssetVersion({ assetId: seed.assetId, prompt: '第二版正文' })
    const v2 = await store.getActivePrompt('agent')
    expect(v2).toMatchObject({ id: 'ep-agent@2', promptVersion: 'V2' })
    await store.insertChecked({
      rows: [
        experienceRow('ex-v2', {
          generationPromptId: v2!.id,
          generationPromptVersion: v2!.promptVersion,
          decisionRetrievalText: '第二版生成的经验',
        }),
      ],
      duplicateOf: keepAllJudge,
    })

    await store.rollbackPromptAsset(seed.assetId, 1)
    const entries = await store.getRows(['ex-v1', 'ex-v2'])
    expect(entries.map((entry) => [entry.id, entry.generationPromptId, entry.generationPromptVersion])).toEqual([
      ['ex-v1', 'ep-agent@1', 'V1'],
      ['ex-v2', 'ep-agent@2', 'V2'],
    ])
  })
})
