// src/client/sidebar/host-paths.ts
//
// 宿主接入层：官方桌面端文件路径桥（Electron preload 注入的 __DSH_HOST_PATHS__）。
// 官方 ui-conversation 用同一个桥（webUtils.getPathForFile）把浏览器 File 映射回本地
// 绝对路径——「选择文件」要写入任务描述的正是这个路径。普通 Web 没有该桥，浏览器安全
// 模型也不允许读取本地路径，故按 File.path（旧 Electron）→ 文件名逐级降级，保证文件
// 选择流程在任何环境下都不中断。
//
// 官方形状按最小消费面收窄并做运行时守卫：缺失/漂移/抛错一律降级，不伪造官方契约。

/** preload 注入的全局键（与官方 desktop 客户端一致）。 */
const HOST_PATHS_KEY = '__DSH_HOST_PATHS__'

/** 文件路径解析器（宿主接入后向业务层暴露的最小接口）。 */
export type FilePathResolver = (file: File) => string

/** preload 桥的最小形状。 */
interface HostPathBridgeLike {
  pathFor?: unknown
}

/** 读取官方桌面桥（形状漂移时返回 null，不抛错）。 */
function hostPathBridgeOf(): HostPathBridgeLike | null {
  const candidate = (globalThis as Record<string, unknown>)[HOST_PATHS_KEY]
  return typeof candidate === 'object' && candidate !== null ? (candidate as HostPathBridgeLike) : null
}

/** 选择结果归一化：非字符串/空白视为不可用（不把脏值写进任务描述）。 */
function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  return path === '' ? null : path
}

/** 官方桌面桥给出的绝对路径；桥缺失/漂移/调用失败返回 null（由调用方降级）。 */
export function hostFilePathOf(file: File): string | null {
  const bridge = hostPathBridgeOf()
  if (bridge === null || typeof bridge.pathFor !== 'function') return null
  try {
    return normalizePath((bridge.pathFor as (file: File) => unknown).call(bridge, file))
  } catch {
    // 官方桥异常不应让文件选择失败：降级到旧字段/文件名。
    return null
  }
}

/** 旧 Electron 的 File.path 回退；最后回退文件名（浏览器下只能拿到文件名）。 */
export function legacyFilePathOf(file: File): string {
  const path = (file as File & { path?: unknown }).path
  return typeof path === 'string' && path.trim() !== '' ? path.trim() : file.name
}

/**
 * 构造文件路径解析器：桌面端官方桥优先，其次旧 File.path，最后文件名。
 * 每次调用实时读取全局桥（官方 preload 可能晚于插件激活）。
 */
export function createFilePathResolver(): FilePathResolver {
  return (file) => hostFilePathOf(file) ?? legacyFilePathOf(file)
}
