import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('Dify 工具迁移端点', () => {
  it('把单包或批量 ZIP 上传交给领域服务', async () => {
    const h = await makeHarness()
    const install = vi.fn(async ({ name }: { name: string; base64: string }) => ({
      uploadName: name,
      packages: [],
      summary: { discovered: 0, installed: 0, converted: 0, skipped: 0, duplicates: 0, failed: 0 },
    }))
    h.host.migratedToolMigration = { install }

    const result = await h.api.handle('migrateDifyTools', { name: 'plugins.zip', base64: 'eA==' })

    expect(install).toHaveBeenCalledWith({ name: 'plugins.zip', base64: 'eA==' })
    expect(result).toMatchObject({ uploadName: 'plugins.zip' })
  })

  it('能力未装配和缺少参数时返回稳定错误', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('migrateDifyTools', { name: 'x.difypkg', base64: 'eA==' }))
      .rejects.toMatchObject({ status: 501, code: 'DIFY_MIGRATOR_UNAVAILABLE' })
    h.host.migratedToolMigration = { install: vi.fn() }
    await expect(h.api.handle('migrateDifyTools', { name: '', base64: '' }))
      .rejects.toMatchObject({ status: 400, code: 'DIFY_UPLOAD_INVALID' })
  })
})
