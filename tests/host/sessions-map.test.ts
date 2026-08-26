// tests/host/sessions-map.test.ts
//
// userId→sessionId 映射单测（T-033）：映射隔离（不同 userId 独立）/同 userId
// 稳定/磁盘持久化/服务重启恢复/并发解析单 sessionId/映射文件按服务隔离。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { SessionMap, SESSION_ID_PREFIX } from '../../src/host/service/sessions-map.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function makeStore(): Promise<FlowStore> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-sessions-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  return store
}

describe('SessionMap', () => {
  it('不同 userId 解析出不同 sessionId（会话隔离）', async () => {
    const store = await makeStore()
    const map = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-a' })
    const a = await map.resolve('user-1')
    const map2 = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-b' })
    const b = await map2.resolve('user-2')
    expect(a).not.toBe(b)
    expect(a).toMatch(new RegExp(`^${SESSION_ID_PREFIX}`))
  })

  it('同 userId 多次解析返回同一 sessionId（稳定映射）', async () => {
    const store = await makeStore()
    const map = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-x' })
    const first = await map.resolve('user-1')
    const second = await map.resolve('user-1')
    expect(second).toBe(first)
  })

  it('映射持久化到磁盘（services/<id>.sessions.json 原子写）', async () => {
    const store = await makeStore()
    const map = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-p' })
    const sessionId = await map.resolve('user-1')
    const raw = await readFile(join(store.root, 'services', 'svc-1.sessions.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ 'user-1': sessionId })
  })

  it('服务重启恢复：新实例从磁盘恢复既有映射（同 userId 同 sessionId）', async () => {
    const store = await makeStore()
    const first = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-old' })
    const sessionId = await first.resolve('user-1')
    // 模拟服务进程重启：全新实例（新 sessionId 生成器也不影响——磁盘命中优先）
    const second = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-new' })
    expect(await second.resolve('user-1')).toBe(sessionId)
  })

  it('并发解析同一 userId 只生成一个 sessionId（pending 去重）', async () => {
    const store = await makeStore()
    const map = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => 'uuid-c' })
    const results = await Promise.all([
      map.resolve('user-1'),
      map.resolve('user-1'),
      map.resolve('user-1'),
    ])
    expect(new Set(results).size).toBe(1)
    expect(map.snapshot().get('user-1')).toBe(results[0])
  })

  it('并发解析不同 userId：磁盘映射合并不互相覆盖（T-033 竞态回归）', async () => {
    const store = await makeStore()
    let seq = 0
    const map = new SessionMap({ store, serviceId: 'svc-1', newSessionId: () => `uuid-${++seq}` })
    // 并发首解析（不同 userId 同时命中 ensure 的读改写窗口）：修复前
    // read-modify-write 跨两次锁作用域，后写覆盖先写 → 磁盘丢映射；修复后
    // mergeUserIdMap 把合并收进同一把锁，两个用户映射同时落盘。
    const results = await Promise.all([
      map.resolve('user-1'),
      map.resolve('user-2'),
      map.resolve('user-3'),
    ])
    expect(new Set(results).size).toBe(3)
    const raw = await readFile(join(store.root, 'services', 'svc-1.sessions.json'), 'utf8')
    const disk = JSON.parse(raw) as Record<string, string>
    expect(Object.keys(disk).sort()).toEqual(['user-1', 'user-2', 'user-3'])
    expect(disk['user-1']).toBe(results[0])
    expect(disk['user-2']).toBe(results[1])
    expect(disk['user-3']).toBe(results[2])
  })

  it('映射按服务隔离（不同 serviceId 互不干扰）', async () => {
    const store = await makeStore()
    const mapA = new SessionMap({ store, serviceId: 'svc-a', newSessionId: () => 'uuid-a' })
    const mapB = new SessionMap({ store, serviceId: 'svc-b', newSessionId: () => 'uuid-b' })
    const a = await mapA.resolve('user-1')
    const b = await mapB.resolve('user-1')
    expect(a).not.toBe(b)
    expect(await mapA.resolve('user-1')).toBe(a)
    expect(await mapB.resolve('user-1')).toBe(b)
  })
})
