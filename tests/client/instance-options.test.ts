// @vitest-environment jsdom

// tests/client/instance-options.test.ts
//
// 「开启新会话」+ 工作区路径缓存（instance-options.ts）纯函数单测：
//   - 空/损坏回退默认值；round-trip 读写一致；字段类型归一化（newSession 布尔化、
//     workspacePath 字符串化）——缓存数据可能与界面当前版本不一致（手工编辑/旧版
//     本遗留），必须防御性归一化。

import { describe, expect, it } from 'vitest'
import {
  INSTANCE_OPTIONS_KEY,
  defaultInstanceOptions,
  restoreInstanceOptions,
  keepInstanceOptions,
} from '../../src/client/studio/instance-options.js'

/** 内存存储（仿 useWorkbenchView.test 的 memStorage）。 */
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

describe('instanceOptions 缓存读写', () => {
  it('空存储 → 默认值（未缓存过：newSession=false、workspacePath=""）', () => {
    expect(restoreInstanceOptions(memStorage())).toEqual({ newSession: false, workspacePath: '' })
    expect(restoreInstanceOptions(memStorage({})).newSession).toBe(false)
  })

  it('keep → restore 往返一致', () => {
    const s = memStorage()
    keepInstanceOptions(s, { newSession: true, workspacePath: '/work/ws' })
    expect(s.store[INSTANCE_OPTIONS_KEY]).toBe(JSON.stringify({ newSession: true, workspacePath: '/work/ws' }))
    expect(restoreInstanceOptions(s)).toEqual({ newSession: true, workspacePath: '/work/ws' })
    // 再写默认值 → 读回默认
    keepInstanceOptions(s, defaultInstanceOptions())
    expect(restoreInstanceOptions(s)).toEqual({ newSession: false, workspacePath: '' })
  })

  it('损坏 JSON → 回退默认值', () => {
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: '{oops' }))).toEqual(defaultInstanceOptions())
    expect(restoreInstanceOptions(memStorage({ [INSTANCE_OPTIONS_KEY]: 'null' }))).toEqual(defaultInstanceOptions())
  })

  it('字段类型归一化：newSession 布尔化、workspacePath 字符串化（防御手工/旧数据）', () => {
    const s = memStorage({ [INSTANCE_OPTIONS_KEY]: JSON.stringify({ newSession: 'yes', workspacePath: 42 }) })
    expect(restoreInstanceOptions(s)).toEqual({ newSession: false, workspacePath: '' })
    const s2 = memStorage({ [INSTANCE_OPTIONS_KEY]: JSON.stringify({ newSession: 1, workspacePath: null }) })
    expect(restoreInstanceOptions(s2)).toEqual({ newSession: false, workspacePath: '' })
  })

  it('写缓存同样归一化（newSession 仅接受布尔、workspacePath 仅接受字符串）', () => {
    const s = memStorage()
    keepInstanceOptions(s, { newSession: 'true' as unknown as boolean, workspacePath: 7 as unknown as string })
    expect(s.store[INSTANCE_OPTIONS_KEY]).toBe(JSON.stringify({ newSession: false, workspacePath: '' }))
  })

  it('getItem 抛异常（隐私模式等）→ 回退默认且不抛出', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(restoreInstanceOptions(throwing)).toEqual(defaultInstanceOptions())
    expect(() => keepInstanceOptions(throwing, { newSession: true, workspacePath: 'x' })).not.toThrow()
  })
})