// @vitest-environment jsdom

// tests/client/studio/instance-options.test.ts
//
// 「开启新会话」界面记忆（instance-options.ts）纯函数单测：
//   模板态的勾选/工作区已改为模板级持久化配置（随模板保存），本缓存只服务
//   **资产态**的一次性勾选记忆——因此只保留 newSession；旧缓存里的 workspacePath
//   读取时忽略（不得把旧的全局路径当成模板配置）。
//   - 空/损坏回退默认值；round-trip 读写一致；字段类型归一化（newSession 布尔化）；
//   - 旧版本缓存（含 workspacePath）兼容读、写回时收敛为新形状。

import { describe, expect, it } from 'vitest'
import {
  INSTANCE_OPTIONS_KEY,
  defaultInstanceOptions,
  restoreInstanceOptions,
  keepInstanceOptions,
} from '../../../src/client/studio/instance-options.js'

/** 内存存储（仿 usePanelLayout.test 的 memStorage）。 */
function memStorage(initial: Record<string, string> = {}): {
  store: Record<string, string>
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
} {
  const store = { ...initial }
  return {
    store,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
  }
}

describe('instanceOptions 缓存读写（资产态一次性勾选记忆）', () => {
  it('空存储 → 默认值（未缓存过：newSession=false）', () => {
    expect(restoreInstanceOptions(memStorage())).toEqual({ newSession: false })
    expect(restoreInstanceOptions(memStorage({})).newSession).toBe(false)
  })

  it('keep → restore 往返一致；写回形状只含 newSession', () => {
    const s = memStorage()
    keepInstanceOptions(s, { newSession: true })
    expect(s.store[INSTANCE_OPTIONS_KEY]).toBe(JSON.stringify({ newSession: true }))
    expect(restoreInstanceOptions(s)).toEqual({ newSession: true })
    // 再写默认值 → 读回默认
    keepInstanceOptions(s, defaultInstanceOptions())
    expect(restoreInstanceOptions(s)).toEqual({ newSession: false })
  })

  it('旧版本缓存（含 workspacePath）兼容读：只取 newSession，不把旧全局路径当模板配置', () => {
    const legacy = memStorage({
      [INSTANCE_OPTIONS_KEY]: JSON.stringify({ newSession: true, workspacePath: 'D:\\old\\global\\ws' }),
    })
    expect(restoreInstanceOptions(legacy)).toEqual({ newSession: true })
    // 写回后收敛为新形状（旧字段不再被写出）
    keepInstanceOptions(legacy, { newSession: true })
    expect(JSON.parse(legacy.store[INSTANCE_OPTIONS_KEY]!)).toEqual({ newSession: true })
  })

  it('损坏 JSON → 回退默认值', () => {
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: '{oops' }))).toEqual(defaultInstanceOptions())
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: 'null' }))).toEqual(defaultInstanceOptions())
  })

  it('字段类型归一化：newSession 仅接受布尔 true（手工/旧数据防御）', () => {
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: JSON.stringify({ newSession: 'yes' }) }))).toEqual({ newSession: false })
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: JSON.stringify({ newSession: 1 }) }))).toEqual({ newSession: false })
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: JSON.stringify({ newSession: true }) }))).toEqual({ newSession: true })
  })

  it('写缓存同样归一化（非布尔 true 一律写 false）', () => {
    const s = memStorage()
    keepInstanceOptions(s, { newSession: 'true' as unknown as boolean })
    expect(s.store[INSTANCE_OPTIONS_KEY]).toBe(JSON.stringify({ newSession: false }))
  })

  it('getItem 抛异常（隐私模式等）→ 回退默认且不抛出', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(restoreInstanceOptions(throwing)).toEqual(defaultInstanceOptions())
    expect(() => keepInstanceOptions(throwing, { newSession: true })).not.toThrow()
  })
})
