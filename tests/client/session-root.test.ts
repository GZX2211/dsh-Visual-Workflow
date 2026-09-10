// tests/client/session-root.test.ts
//
// 会话解析缝（sidebar/session-root.ts）：
//   - currentSessionOf：从官方 sessions 快照读当前选中会话（getSnapshot 优先、get 回退）；
//   - rootSessionIdOf：沿父链上溯到会话树根（实例/服务按会话树根隔离）。
// 【0.1.5-rc.1 关键】官方 client 侧 SessionSummary 的父链字段是 **parentId**
// （dsh-api-session-controller/client/sessions/service.d.ts:39），0.1.2 时代曾写作
// parentSessionId —— 两者都要能读（双读兼容），否则子代理会话无法上溯到根。

import { describe, expect, it, vi } from 'vitest'
import { currentSessionOf, rootSessionIdOf } from '../../src/client/sidebar/session-root.js'

/** 构造 sessions 服务 fake（byId 中每项可带 parentId 或 parentSessionId）。 */
function sessionsOf(
  entries: Array<{ id: string; parentId?: string; parentSessionId?: string }>,
  options: { current?: string; useGetSnapshot?: boolean; withSubscribe?: boolean; useGet?: boolean } = {},
) {
  const byId: Record<string, unknown> = {}
  for (const entry of entries) {
    byId[entry.id] = { parentId: entry.parentId, parentSessionId: entry.parentSessionId }
  }
  const snapshot = { current: options.current ?? entries[0]?.id, byId }
  const list: Record<string, unknown> = {}
  if (options.useGet === true) list.get = () => snapshot
  else if (options.useGetSnapshot === false) list.get = () => snapshot
  else list.getSnapshot = () => snapshot
  if (options.withSubscribe === true) list.subscribe = vi.fn(() => () => {})
  return { list } as never
}

describe('currentSessionOf：当前选中会话解析', () => {
  it('getSnapshot().current 命中（0.1.5 读法）', () => {
    expect(currentSessionOf({ get: () => sessionsOf([{ id: 's-1' }], { current: 's-9' }) })).toBe('s-9')
  })

  it('无 getSnapshot 时回退 get().current（旧运行时）', () => {
    expect(currentSessionOf({ get: () => sessionsOf([{ id: 's-1' }], { current: 's-2', useGet: true }) })).toBe('s-2')
  })

  it('sessions 服务缺失 / current 非字符串：返回空串（守卫）', () => {
    expect(currentSessionOf({ get: () => null })).toBe('')
    expect(currentSessionOf({})).toBe('')
    expect(currentSessionOf({ get: () => ({ list: { getSnapshot: () => ({ current: 42 }) } }) })).toBe('')
  })
})

describe('rootSessionIdOf：会话树根解析（实例/服务按会话树根隔离）', () => {
  it('parentId（0.1.5 客户端字段）子代理会话：上溯到根', () => {
    const sessions = sessionsOf([
      { id: 'root' },
      { id: 'child-1', parentId: 'root' },
      { id: 'child-2', parentId: 'child-1' },
    ])
    expect(rootSessionIdOf('child-1', sessions)).toBe('root')
    expect(rootSessionIdOf('child-2', sessions)).toBe('root')
    expect(rootSessionIdOf('root', sessions)).toBe('root')
  })

  it('parentSessionId（旧字段）子代理会话：同样上溯到根（双读兼容）', () => {
    const sessions = sessionsOf([
      { id: 'root' },
      { id: 'child-1', parentSessionId: 'root' },
      { id: 'child-2', parentSessionId: 'child-1' },
    ])
    expect(rootSessionIdOf('child-2', sessions)).toBe('root')
  })

  it('优先 parentId；两字段同时存在时以 parentId 为准', () => {
    const sessions = sessionsOf([
      { id: 'root-a' },
      { id: 'root-b' },
      { id: 'child', parentId: 'root-a', parentSessionId: 'root-b' },
    ])
    expect(rootSessionIdOf('child', sessions)).toBe('root-a')
  })

  it('快照不含 byId（旧运行时）或父不在表内：回退自身', () => {
    expect(rootSessionIdOf('session-x', { list: { get: () => ({ current: 'session-x' }) } } as never)).toBe('session-x')
    expect(rootSessionIdOf('orphan', sessionsOf([{ id: 'orphan', parentId: 'missing' }]))).toBe('orphan')
  })

  it('父链成环：不死循环，返回环内某节点', () => {
    const sessions = sessionsOf([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ])
    expect(['a', 'b']).toContain(rootSessionIdOf('a', sessions))
  })

  it('空会话 id 返回空串（未激活守卫）', () => {
    expect(rootSessionIdOf('', sessionsOf([]))).toBe('')
  })
})
