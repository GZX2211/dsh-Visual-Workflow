// src/client/sidebar/workspace-picker.ts
//
// 宿主接入层：官方目录选择器的读取缝（「选择工作区路径」复用官方实现）。
//
// 两条官方通道，按 Electron 桌面 / 普通 Web 自动分派（与官方
// dsh-client-ui-directory-picker-native 的行为同口径）：
//   1. Electron 桌面：preload 通过 contextBridge 暴露的窄接口
//      `globalThis.__DSH_DIRECTORY_PICKER__.pick()`（主进程 dialog.showOpenDialog，
//      即系统「选择文件夹」对话框）；
//   2. 普通 Web：官方 ui-workspace 服务的 pickDirectory()（host 端系统对话框，
//      远程浏览器同样可用，因为对话框开在 host 机器上）。
// 两者都不可用时 available()=false，pick() 抛可判定错误——调用方据此禁用按钮并
// 提示「当前环境不支持官方目录选择器」，其余功能照常（路径留空即继承当前会话工作区）。
//
// 官方形状按最小消费面收窄并做运行时守卫：缺失即降级，不伪造官方不存在的契约。

/** 插件上下文的最小形状（服务经 get 运行时解析）。 */
export interface WorkspacePickerContext {
  get?(name: string): unknown
}

/** 目录选择器能力（宿主接入后向业务层暴露的最小接口）。 */
export interface WorkspacePicker {
  /** 当前环境是否具备官方目录选择器（实时判定：官方服务可能晚于插件激活）。 */
  available(): boolean
  /** 打开官方目录选择器；取消返回 null，不可用/失败抛错。 */
  pick(): Promise<string | null>
}

/** 官方目录选择器不可用（稳定错误类型，调用方据此显示词典文案而非通用错误）。 */
export class WorkspacePickerUnavailableError extends Error {
  constructor() {
    super('official directory picker is unavailable in this environment')
    this.name = 'WorkspacePickerUnavailableError'
  }
}

/** Electron preload 注入的全局键（与官方 directory-picker-native 客户端一致）。 */
const PRELOAD_KEY = '__DSH_DIRECTORY_PICKER__'

/** preload 窄接口的最小形状。 */
interface PreloadDirectoryPickerLike {
  pick?: unknown
}

/** 官方 ui-workspace 服务的最小形状（只消费 pickDirectory）。 */
interface UiWorkspaceLike {
  pickDirectory?: unknown
}

/** 读取 preload 接口（形状漂移时返回 null，不抛错）。 */
function preloadPickerOf(): PreloadDirectoryPickerLike | null {
  const candidate = (globalThis as Record<string, unknown>)[PRELOAD_KEY]
  return typeof candidate === 'object' && candidate !== null ? (candidate as PreloadDirectoryPickerLike) : null
}

/** 读取官方 ui-workspace 服务（未激活/形状不符时返回 null）。 */
function uiWorkspaceOf(ctx: WorkspacePickerContext): UiWorkspaceLike | null {
  const candidate = ctx.get?.('uiWorkspace')
  return typeof candidate === 'object' && candidate !== null ? (candidate as UiWorkspaceLike) : null
}

/** 选择结果归一化：非字符串/空白视为取消（不把脏值写进模板配置）。 */
function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  return path === '' ? null : path
}

/**
 * 构造官方目录选择器接入缝。
 * @param ctx - 官方 client 插件上下文（只读服务，不持有生命周期）。
 * @returns 选择器能力（可用性每次调用实时判定）。
 */
export function createWorkspacePicker(ctx: WorkspacePickerContext): WorkspacePicker {
  return {
    available(): boolean {
      const preload = preloadPickerOf()
      if (preload !== null && typeof preload.pick === 'function') return true
      const uiWorkspace = uiWorkspaceOf(ctx)
      return uiWorkspace !== null && typeof uiWorkspace.pickDirectory === 'function'
    },
    async pick(): Promise<string | null> {
      const preload = preloadPickerOf()
      if (preload !== null && typeof preload.pick === 'function') {
        const raw = await (preload.pick as () => unknown).call(preload)
        return normalizePath(raw)
      }
      const uiWorkspace = uiWorkspaceOf(ctx)
      if (uiWorkspace === null || typeof uiWorkspace.pickDirectory !== 'function') {
        throw new WorkspacePickerUnavailableError()
      }
      const raw = await (uiWorkspace.pickDirectory as () => unknown).call(uiWorkspace)
      return normalizePath(raw)
    },
  }
}
