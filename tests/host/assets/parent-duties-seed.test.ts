// tests/host/assets/parent-duties-seed.test.ts
//
// 父代理职责资产播种测试（宿主安装动作，非库的形状契约）：
//   - 裸库不凭空多出内置资产；显式播种后才有唯一一条 kind='parent' 的资产（V1 = 五维正文）；
//   - 重复播种幂等（Active 仍指向版本 1）；
//   - 库中已有 parent 资产（用户自建）时不再播种，也不覆盖既有内容；
//   - 正文是非组装的纯文本（不含模板变量语法）。

import { afterEach, describe, expect, it } from 'vitest'
import { AssetStore, PARENT_DUTIES_ASSET_ID } from '../../../src/host/assets/index.js'
import { PARENT_ROLE_DUTIES } from '../../../src/host/prompts/index.js'
import { makeStore, removeTempRoot, roleTemplate } from './fixtures/asset-fixture.js'

/** 已创建的库统一登记清理（用例可能中途失败）。 */
const opened: Array<{ store: AssetStore; root: string }> = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    entry.store.close()
    await removeTempRoot(entry.root)
  }
})

/** 库中的 parent 类型角色资产条数（内置唯一性的判据）。 */
async function parentAssetCount(store: AssetStore): Promise<number> {
  const roles = await store.listRoleAssets()
  return roles.filter((role) => role.kind === 'parent').length
}

describe('父代理职责资产播种', () => {
  it('显式播种：库中出现唯一一条 parent 资产，Active V1 = 五维正文', async () => {
    const created = await makeStore()
    opened.push(created)
    // 播种是宿主安装动作：裸库不该凭空多出内置资产
    expect(await parentAssetCount(created.store)).toBe(0)

    await created.store.seedParentDuties()

    const detail = await created.store.getRoleAsset(PARENT_DUTIES_ASSET_ID)
    expect(detail).toMatchObject({
      assetId: PARENT_DUTIES_ASSET_ID,
      versionId: 1,
      kind: 'parent',
      roleAssetType: 'standalone',
    })
    expect(detail?.systemPrompt).toBe(PARENT_ROLE_DUTIES)
    expect(await parentAssetCount(created.store)).toBe(1)
  })

  it('重复播种幂等：版本列表仍只有 1 版，Active 不动', async () => {
    const created = await makeStore()
    opened.push(created)
    await created.store.seedParentDuties()
    await created.store.seedParentDuties()

    const versions = await created.store.listRoleVersions(PARENT_DUTIES_ASSET_ID)
    expect(versions).toHaveLength(1)
    expect((await created.store.getRoleAsset(PARENT_DUTIES_ASSET_ID))?.versionId).toBe(1)
  })

  it('库中已有 parent 资产（用户自建）时不播种，既有内容不被覆盖', async () => {
    const created = await makeStore()
    opened.push(created)
    await created.store.promoteRole({
      templateId: 'tpl-parent-user',
      fingerprint: 'fp-parent-user',
      role: { ...roleTemplate(), kind: 'parent', name: '用户自建父代理', systemPrompt: '用户自己写的父代理职责。' },
      source: 'human',
    })

    await created.store.seedParentDuties()

    expect(await created.store.getRoleAsset(PARENT_DUTIES_ASSET_ID)).toBeNull()
    expect(await parentAssetCount(created.store)).toBe(1)
  })

  it('正文是非组装纯文本：不含模板变量语法', () => {
    expect(PARENT_ROLE_DUTIES).not.toContain('{{')
    expect(PARENT_ROLE_DUTIES.trim().length).toBeGreaterThan(200)
  })
})
