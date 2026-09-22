// tests/host/workspace-path.test.ts
//
// 新会话工作区路径校验单测（src/host/workspace-path.ts）：
// 存在目录通过 / 空值忽略 / 不存在报错 / 文件（非目录）报错。
// 该能力是 host 级横切输入校验契约（GUI 端点与定时任务端点共用），故归属 host 根测试。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWorkspacePath } from '../../src/host/workspace-path.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

/** 临时目录（登记清理）。 */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-ws-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('resolveWorkspacePath', () => {
  it('存在的目录：通过并返回原路径', async () => {
    const dir = await tempDir()
    expect(await resolveWorkspacePath(dir)).toBe(dir)
  })

  it('空值/空白：返回 undefined（未配置）', async () => {
    expect(await resolveWorkspacePath('')).toBeUndefined()
    expect(await resolveWorkspacePath(undefined)).toBeUndefined()
    expect(await resolveWorkspacePath('   ')).toBeUndefined()
  })

  it('不存在的路径：明确报错（含路径提示）', async () => {
    await expect(resolveWorkspacePath('D:\\no-such-dir-xyz\\abc')).rejects.toThrow(/工作区路径不存在或不可访问/)
  })

  it('文件而非目录：报错（须为目录）', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a.txt')
    await writeFile(file, 'x', 'utf8')
    await expect(resolveWorkspacePath(file)).rejects.toThrow(/不是目录/)
  })
})
