// tests/client/sidebar/workspace-picker.test.ts
//
// 宿主接入层「官方目录选择器」读取缝单测（node 环境，无 DOM）：
//   - Electron preload 窄接口 `__DSH_DIRECTORY_PICKER__.pick()` 优先（系统「选择文件夹」对话框）；
//   - preload 缺失时回退官方 uiWorkspace.pickDirectory()（host 端系统对话框）；
//   - 两者都不可用 → available()=false，pick() 抛可判定错误（调用方据此禁用按钮并提示）；
//   - 返回路径归一化（trim；空/非字符串视为取消）；取消返回 null；失败向上传播。
//
// 官方形状按最小消费面收窄：本文件同时锁定「形状漂移按不可用降级、不伪造官方契约」。

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspacePickerUnavailableError,
  createWorkspacePicker,
  type WorkspacePickerContext,
} from '../../../src/client/sidebar/workspace-picker.js'

const PRELOAD_KEY = '__DSH_DIRECTORY_PICKER__'

/** 模拟 preload 注入（Electron 桌面）；undefined 表示未注入。 */
function setPreload(value: unknown): void {
  const holder = globalThis as Record<string, unknown>
  if (value === undefined) delete holder[PRELOAD_KEY]
  else holder[PRELOAD_KEY] = value
}

/** 模拟官方 client ctx：只认 uiWorkspace 服务名。 */
function ctxWith(uiWorkspace: unknown): WorkspacePickerContext {
  return { get: (name: string) => (name === 'uiWorkspace' ? uiWorkspace : null) }
}

afterEach(() => {
  setPreload(undefined)
  vi.restoreAllMocks()
})

describe('官方目录选择器接入：通道优先级', () => {
  it('preload 存在时优先使用（且规范化空白），不触达 uiWorkspace', async () => {
    const uiPick = vi.fn(async () => 'D:\\from-ui')
    setPreload({ pick: vi.fn(async () => '  D:\\from-preload  ') })
    const picker = createWorkspacePicker(ctxWith({ pickDirectory: uiPick }))

    expect(picker.available()).toBe(true)
    await expect(picker.pick()).resolves.toBe('D:\\from-preload')
    expect(uiPick).not.toHaveBeenCalled()
  })

  it('preload 取消（返回 null）→ pick 返回 null', async () => {
    setPreload({ pick: vi.fn(async () => null) })
    const picker = createWorkspacePicker(ctxWith(null))
    await expect(picker.pick()).resolves.toBeNull()
  })

  it('preload 返回非字符串/空白 → 归一化为 null（视为未选择）', async () => {
    for (const value of [undefined, 42, '', '   ']) {
      setPreload({ pick: vi.fn(async () => value) })
      const picker = createWorkspacePicker(ctxWith(null))
      await expect(picker.pick()).resolves.toBeNull()
    }
  })

  it('preload 缺失时回退 uiWorkspace.pickDirectory（保留 this 绑定），返回去空白路径', async () => {
    const service = {
      value: 'D:\\from-ui',
      async pickDirectory(): Promise<string> {
        return `  ${this.value}  `
      },
    }
    const picker = createWorkspacePicker(ctxWith(service))

    expect(picker.available()).toBe(true)
    await expect(picker.pick()).resolves.toBe('D:\\from-ui')
  })

  it('preload 的 pick 不是函数（形状漂移）→ 视为不存在，继续回退 uiWorkspace', async () => {
    setPreload({ pick: 42 })
    const uiPick = vi.fn(async () => 'D:\\ui-fallback')
    const picker = createWorkspacePicker(ctxWith({ pickDirectory: uiPick }))

    expect(picker.available()).toBe(true)
    await expect(picker.pick()).resolves.toBe('D:\\ui-fallback')
  })
})

describe('官方目录选择器接入：不可用降级', () => {
  it('preload 与 uiWorkspace 都缺失 → available=false，pick 抛可判定错误', async () => {
    const picker = createWorkspacePicker({ get: () => null })

    expect(picker.available()).toBe(false)
    await expect(picker.pick()).rejects.toBeInstanceOf(WorkspacePickerUnavailableError)
  })

  it('uiWorkspace 存在但 pickDirectory 非函数 → 不可用', async () => {
    const picker = createWorkspacePicker(ctxWith({ pickDirectory: 'oops' }))

    expect(picker.available()).toBe(false)
    await expect(picker.pick()).rejects.toBeInstanceOf(WorkspacePickerUnavailableError)
  })

  it('ctx 未提供 get（旧运行时）→ 不可用而非抛错', async () => {
    const picker = createWorkspacePicker({})

    expect(picker.available()).toBe(false)
    await expect(picker.pick()).rejects.toBeInstanceOf(WorkspacePickerUnavailableError)
  })

  it('选择器实现抛错 → 错误原样向上传播（调用方可提示，不伪装成取消）', async () => {
    const failure = new Error('dialog failed')
    setPreload({ pick: vi.fn(async () => { throw failure }) })
    const picker = createWorkspacePicker(ctxWith(null))

    await expect(picker.pick()).rejects.toBe(failure)
  })
})
