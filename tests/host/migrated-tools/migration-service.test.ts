import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MigratedToolMigrationError,
  MigratedToolMigrationService,
  type MigrationDriver,
} from '../../../src/host/migrated-tools/migration-service.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function report(status: 'installed' | 'skipped' = 'installed') {
  return {
    packages: [{
      sourcePath: '/private/staging/vendor-tool.difypkg',
      status,
      packageId: 'vendor/tool',
      dshPackageId: 'dsh_migrated__vendor__tool',
      version: '1.0.0',
      tools: ['dsh_migrated__vendor__tool__run'],
      credentials: [],
    }],
    summary: {
      discovered: 1,
      installed: status === 'installed' ? 1 : 0,
      converted: 0,
      skipped: status === 'skipped' ? 1 : 0,
      duplicates: 0,
      failed: 0,
    },
  }
}

describe('MigratedToolMigrationService', () => {
  it.each(['bundle.difypkg', 'batch.zip'])('stages %s, invokes the compiler and refreshes installed tools', async (name) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-dify-upload-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const seen: Buffer[] = []
    const driver: MigrationDriver = {
      async convert(inputPath) {
        seen.push(await readFile(inputPath))
        return report()
      },
    }
    const refresh = vi.fn(async () => {})
    const service = new MigratedToolMigrationService({ dataDirectory: directory, command: 'unused', refresh, driver })

    const result = await service.install({ name, base64: Buffer.from('package-bytes').toString('base64') })

    expect(seen).toEqual([Buffer.from('package-bytes')])
    expect(result.uploadName).toBe(name)
    expect(result.packages[0]?.sourcePath).toBe('vendor-tool.difypkg')
    expect(result.summary.installed).toBe(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh the registry when every package is skipped', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-dify-upload-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const refresh = vi.fn(async () => {})
    const driver: MigrationDriver = { convert: async () => report('skipped') }
    const service = new MigratedToolMigrationService({ dataDirectory: directory, command: 'unused', refresh, driver })

    const result = await service.install({ name: 'models.difypkg', base64: Buffer.from('x').toString('base64') })

    expect(result.summary.skipped).toBe(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'bundle.tar', base64: Buffer.from('x').toString('base64') },
    { name: 'bundle.zip', base64: 'not-base64' },
  ])('rejects an invalid upload before invoking the compiler', async (upload) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-dify-upload-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const driver: MigrationDriver = { convert: vi.fn(async () => report()) }
    const service = new MigratedToolMigrationService({ dataDirectory: directory, command: 'unused', refresh: async () => {}, driver })

    await expect(service.install(upload)).rejects.toMatchObject({ code: 'DIFY_UPLOAD_INVALID' } satisfies Partial<MigratedToolMigrationError>)
    expect(driver.convert).not.toHaveBeenCalled()
  })
})
