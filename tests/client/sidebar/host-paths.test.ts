// tests/client/sidebar/host-paths.test.ts
//
// 宿主接入层单测：官方桌面端文件路径桥（Electron preload 注入的 __DSH_HOST_PATHS__）
// 让浏览器 File 能稳定映射回本地绝对路径；桥缺失/异常时必须降级且不中断文件选择。
// 官方 ui-conversation 的“文件 file”命令走同一个桥（webUtils.getPathForFile），
// 本文件锁定的就是这条可复用官方逻辑。

import { afterEach, describe, expect, it } from 'vitest'
import { createFilePathResolver, hostFilePathOf, legacyFilePathOf } from '../../../src/client/sidebar/host-paths.js'

/** preload 注入的全局键（与官方 desktop 客户端一致）。 */
const HOST_PATHS_KEY = '__DSH_HOST_PATHS__'

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HOST_PATHS_KEY]
})

/** 构造带旧 Electron File.path 的文件（浏览器安全模型下该字段不存在）。 */
function fileWithPath(name: string, path?: string): File {
  const file = new File(['x'], name)
  if (path !== undefined) Object.defineProperty(file, 'path', { value: path })
  return file
}

/** 安装官方桌面桥替身。 */
function installBridge(pathFor: (file: File) => unknown): void {
  ;(globalThis as Record<string, unknown>)[HOST_PATHS_KEY] = { pathFor }
}

describe('官方桌面文件路径桥', () => {
  it('桌面端：__DSH_HOST_PATHS__.pathFor 的结果就是注入路径（优先于旧 File.path）', () => {
    installBridge(() => 'D:/ws/absolute/a.txt')
    const file = fileWithPath('a.txt', 'D:/ws/stale/a.txt')

    expect(hostFilePathOf(file)).toBe('D:/ws/absolute/a.txt')
    expect(createFilePathResolver()(file)).toBe('D:/ws/absolute/a.txt')
  })

  it('桥缺失：hostFilePathOf 返回 null；解析器回退 File.path，再回退文件名', () => {
    expect(hostFilePathOf(fileWithPath('a.txt', 'D:/ws/a.txt'))).toBeNull()
    expect(createFilePathResolver()(fileWithPath('a.txt', 'D:/ws/a.txt'))).toBe('D:/ws/a.txt')
    expect(createFilePathResolver()(new File(['x'], 'a.txt'))).toBe('a.txt')
  })

  it('桥返回空白或非字符串：不写脏路径，回退 File.path / 文件名', () => {
    installBridge(() => '   ')
    expect(hostFilePathOf(new File(['x'], 'a.txt'))).toBeNull()
    expect(createFilePathResolver()(fileWithPath('a.txt', 'D:/ws/a.txt'))).toBe('D:/ws/a.txt')

    installBridge(() => 42)
    expect(createFilePathResolver()(new File(['x'], 'a.txt'))).toBe('a.txt')
  })

  it('桥调用抛错：降级而不让文件选择流程失败', () => {
    installBridge(() => { throw new Error('bridge failed') })

    expect(hostFilePathOf(new File(['x'], 'a.txt'))).toBeNull()
    expect(createFilePathResolver()(fileWithPath('a.txt', 'D:/ws/a.txt'))).toBe('D:/ws/a.txt')
  })

  it('桥形状漂移（非对象/无 pathFor）：按缺失处理，不抛错', () => {
    ;(globalThis as Record<string, unknown>)[HOST_PATHS_KEY] = 'not-a-bridge'
    expect(hostFilePathOf(new File(['x'], 'a.txt'))).toBeNull()

    ;(globalThis as Record<string, unknown>)[HOST_PATHS_KEY] = {}
    expect(hostFilePathOf(new File(['x'], 'a.txt'))).toBeNull()
  })

  it('legacy：File.path 空白时回退文件名（不产生空路径）', () => {
    expect(legacyFilePathOf(fileWithPath('a.txt', '  '))).toBe('a.txt')
    expect(legacyFilePathOf(fileWithPath('a.txt', ''))).toBe('a.txt')
  })
})
