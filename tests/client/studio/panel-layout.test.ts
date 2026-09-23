// tests/client/studio/panel-layout.test.ts
//
// 面板几何与折叠态持久化（studio/panel-layout.ts）纯函数单测：
//   ① 缺失键回退默认；合法值恢复；非法/越界（mode 越界或非数字、宽度 0/负数/垃圾文本）回退默认；
//   ② keepPanelMode 写 mode 键、keepPanelSize 写对应几何键（写失败静默）。
// 环境：纯函数 + 注入内存存储，无需 jsdom（不触碰 DOM）。

import { describe, expect, it } from 'vitest'
import {
  LAYOUT_KEYS,
  keepPanelMode,
  keepPanelSize,
  restorePanels,
} from '../../../src/client/studio/panel-layout.js'
import { defaultPanels } from '../../../src/client/studio/studio-initial.js'
import type { StorageLike } from '../../../src/client/lib/storage.js'

/** 内存存储（仿 instance-options.test 的 memStorage）。 */
function memStorage(initial: Record<string, string> = {}, options: { throwOnSet?: boolean } = {}): {
  store: Record<string, string>
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
} {
  const store = { ...initial }
  return {
    store,
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      if (options.throwOnSet === true) throw new Error('QuotaExceededError')
      store[k] = v
    },
  }
}

describe('restorePanels：缺失键回退默认', () => {
  it('空存储 → 全部默认（mode 0 / 左右 230 / 底 170）', () => {
    expect(restorePanels(memStorage())).toEqual(defaultPanels())
  })
})

describe('restorePanels：合法值恢复', () => {
  it('四键均为合法值 → 原样恢复（刷新后回到上次布局）', () => {
    const storage = memStorage({
      [LAYOUT_KEYS.mode]: '2',
      [LAYOUT_KEYS.leftWidth]: '300',
      [LAYOUT_KEYS.rightWidth]: '410',
      [LAYOUT_KEYS.bottomHeight]: '260',
    })
    expect(restorePanels(storage as StorageLike)).toEqual({
      mode: 2,
      leftWidth: 300,
      rightWidth: 410,
      bottomHeight: 260,
    })
  })
})

describe('restorePanels：非法/越界回退默认', () => {
  const fallback = defaultPanels()

  it('mode 越界或非数字（9 / -1 / abc）→ 回退默认 mode', () => {
    for (const raw of ['9', '-1', 'abc']) {
      expect(restorePanels(memStorage({ [LAYOUT_KEYS.mode]: raw })).mode).toBe(fallback.mode)
    }
  })

  it('宽度为 0 / 负数 / 垃圾文本 → 回退默认宽度', () => {
    for (const raw of ['0', '-5', 'abc']) {
      const panels = restorePanels(memStorage({ [LAYOUT_KEYS.leftWidth]: raw }))
      expect(panels.leftWidth).toBe(fallback.leftWidth)
    }
  })

  it('读取抛错（存储不可用）→ 全部回退默认，不向上抛', () => {
    const storage: StorageLike = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    }
    expect(restorePanels(storage)).toEqual(fallback)
  })
})

describe('keepPanelMode / keepPanelSize：写入对应键', () => {
  it('keepPanelMode 写 mode 键、keepPanelSize 按 side 写各自几何键', () => {
    const storage = memStorage()
    keepPanelMode(storage as StorageLike, 2)
    keepPanelSize(storage as StorageLike, 'left', 300)
    keepPanelSize(storage as StorageLike, 'right', 410)
    keepPanelSize(storage as StorageLike, 'bottom', 260)
    expect(storage.store).toEqual({
      [LAYOUT_KEYS.mode]: '2',
      [LAYOUT_KEYS.leftWidth]: '300',
      [LAYOUT_KEYS.rightWidth]: '410',
      [LAYOUT_KEYS.bottomHeight]: '260',
    })
  })

  it('写入抛错（隐私模式）→ 静默不抛（记忆失败不得影响交互）', () => {
    const storage = memStorage({}, { throwOnSet: true })
    expect(() => keepPanelMode(storage as StorageLike, 1)).not.toThrow()
    expect(() => keepPanelSize(storage as StorageLike, 'left', 300)).not.toThrow()
  })
})
