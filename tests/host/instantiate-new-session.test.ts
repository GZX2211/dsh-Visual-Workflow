// tests/host/instantiate-new-session.test.ts
//
// 「启动时开启新会话 + 工作区」数据模型单测：
//   - 模板 → 实例继承 startNewSession/workspacePath；
//   - 工作区路径校验（resolveWorkspacePath：存在目录通过 / 不存在报错 / 空值忽略）。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { instantiateFromTemplate } from '../../src/host/scheduler/instantiate.js'
import { resolveWorkspacePath } from '../../src/host/workspace/verify.js'
import type { WorkflowTemplate } from '../../src/host/shared/graph-model.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

function template(extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: 'tpl-1',
    mode: 'mode1',
    name: '模板',
    description: '',
    nodes: [],
    lines: [],
    ...extra,
  }
}

describe('instantiateFromTemplate 新会话字段继承', () => {
  it('模板 startNewSession/workspacePath 随实例化继承', () => {
    const instance = instantiateFromTemplate(
      template({ startNewSession: true, workspacePath: 'D:\\work\\tpl-ws' }),
      'session-1',
      [],
      { id: () => 'wf-1' },
    )
    expect(instance.startNewSession).toBe(true)
    expect(instance.workspacePath).toBe('D:\\work\\tpl-ws')
  })

  it('模板未配置 → 实例不携带（undefined）', () => {
    const instance = instantiateFromTemplate(template(), 'session-1', [], { id: () => 'wf-1' })
    expect(instance.startNewSession).toBeUndefined()
    expect(instance.workspacePath).toBeUndefined()
  })
})

describe('resolveWorkspacePath', () => {
  it('存在的目录：通过并返回原路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-ws-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
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
    const dir = await mkdtemp(join(tmpdir(), 'vw-ws-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const file = join(dir, 'a.txt')
    await (await import('node:fs/promises')).writeFile(file, 'x', 'utf8')
    await expect(resolveWorkspacePath(file)).rejects.toThrow(/不是目录/)
  })
})
