// tests/host/storage/graph-patch-log.test.ts
//
// 图补丁记录存储测试（D-05）：计数累加与「最后一次目标」、单资源读语义、会话隔离、
// 列表读跳过损坏项（宿主启动装载必须具备可用性）。
// 断言依据：src/host/storage/AGENTS.md（单资源读可诊断 / 列表读可用 / 读改写同一临界区）。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphPatchLogStore } from '../../../src/host/storage/graph-patch-log.js'

let dir: string
let store: GraphPatchLogStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vw-gplog-'))
  // 真实运行由 FlowStore.init 创建 DIRS；单测直接建目录以隔离被测对象
  await mkdir(join(dir, 'graph-patches'), { recursive: true })
  store = new GraphPatchLogStore(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GraphPatchLogStore', () => {
  it('test_首次记录_计数为 1 且带上最后目标与作用域', async () => {
    const at = 1_700_000_000_000

    const record = await store.record({ sessionId: 'session-1', targetId: 'tpl-1', scope: 'template', now: at })

    expect(record).toMatchObject({
      sessionId: 'session-1',
      count: 1,
      lastTargetId: 'tpl-1',
      lastScope: 'template',
    })
    expect(record.lastAt).toBe(new Date(at).toISOString())
  })

  it('test_同会话多次记录_计数累加且最后目标跟随最新一次', async () => {
    await store.record({ sessionId: 'session-1', targetId: 'tpl-1', scope: 'template' })

    const second = await store.record({ sessionId: 'session-1', targetId: 'wf-9', scope: 'instance' })

    expect(second).toMatchObject({ count: 2, lastTargetId: 'wf-9', lastScope: 'instance' })
    expect(await store.read('session-1')).toMatchObject({ count: 2, lastTargetId: 'wf-9' })
  })

  it('test_未记录会话_单资源读返回 null', async () => {
    expect(await store.read('session-none')).toBeNull()
  })

  it('test_会话隔离_各自独立计数', async () => {
    await store.record({ sessionId: 'session-1', targetId: 'tpl-1', scope: 'template' })
    await store.record({ sessionId: 'session-2', targetId: 'tpl-2', scope: 'template' })
    await store.record({ sessionId: 'session-2', targetId: 'tpl-2', scope: 'template' })

    expect((await store.read('session-1'))?.count).toBe(1)
    expect((await store.read('session-2'))?.count).toBe(2)
  })

  it('test_存在损坏记录_列表读跳过损坏项并保留可用记录', async () => {
    await store.record({ sessionId: 'session-1', targetId: 'tpl-1', scope: 'template' })
    await writeFile(join(dir, 'graph-patches', 'broken.json'), '{ 这不是合法 JSON', 'utf8')

    const ids = await store.listSessionIds()

    expect(ids).toContain('session-1')
    expect(ids).toHaveLength(1)
  })

  it('test_目录不存在_列表读返回空数组而非报错', async () => {
    const fresh = new GraphPatchLogStore(join(dir, 'no-such-root'))

    expect(await fresh.listSessionIds()).toEqual([])
  })
})
