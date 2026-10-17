// src/host/system-language.ts
//
// 从 DSH 用户设置读取语言偏好（locale.preference），映射为面向模型的系统语言名。
// 官方在 dsh-client-locale 中把语言偏好持久化在 profile 配置的 `locale` 命名空间下；
// 本模块的 settings 读取是无缓存的同步纯投影（describe()），供无 GUI 的调用方（调度器、
// 服务、工具静默接续）回退使用。GUI 运行会显式传入当前 Client locale，因为自动选择
// （浏览器 / 原生）不一定回写 locale.preference。

/** 默认语言名（插件默认中文界面；官方未显式选择时按浏览器语言回退，本处保守取中文）。 */
export const DEFAULT_SYSTEM_LANGUAGE = '中文'

/** locale 设置所属的 profile entry id（官方 LOCALE_SETTINGS_NAMESPACE 同名）。 */
const LOCALE_SETTINGS_NS = 'locale'

/** settings 服务最小结构（经 describe() 读取各命名空间的实时解析值；零官方类型依赖）。 */
export interface SettingsServiceLike {
  /** 读取全部 profile 配置表单描述符（同步；每项含 ns 与 value）。 */
  describe?(options?: unknown): unknown
}

/**
 * 从 settings 服务读取系统语言名。
 * 映射：'zh' 前缀 → '中文'；'en' 前缀 → 'English'；其余/缺失 → DEFAULT_SYSTEM_LANGUAGE。
 * 纯函数：输入 settings 对象不变则输出不变；不读时钟/随机源。
 */
export function systemLanguageOf(settings: SettingsServiceLike | null | undefined): string {
  try {
    const descriptors = settings?.describe?.()
    if (!Array.isArray(descriptors)) return DEFAULT_SYSTEM_LANGUAGE
    const locale = descriptors.find((row) => (row as { ns?: unknown } | null)?.ns === LOCALE_SETTINGS_NS) as
      | { value?: { preference?: unknown } }
      | undefined
    return systemLanguageFromLocale(locale?.value?.preference) ?? DEFAULT_SYSTEM_LANGUAGE
  } catch {
    // settings 服务异常：回退默认语言
  }
  return DEFAULT_SYSTEM_LANGUAGE
}

/**
 * 从语言名反推是否中文（供提示词措辞选择）。
 * 纯函数。
 */
export function isChineseSystemLanguage(language: string): boolean {
  return String(language ?? '').startsWith('中')
}

/** 识别英文 locale id 或已解析的语言名（'en' / 'en-US' / 'English'）。 */
export function isEnglishSystemLanguage(language: string | undefined): boolean {
  return /^(en(?:-|$)|english$)/i.test(String(language ?? '').trim())
}

/** 把受支持的 Client locale id 解析为语言名；未知值返回 undefined，交回 Host 回退。 */
export function systemLanguageFromLocale(locale: unknown): string | undefined {
  if (typeof locale !== 'string') return undefined
  const value = locale.trim().toLowerCase()
  if (/^zh(?:-|$)/.test(value)) return '中文'
  if (/^en(?:-|$)/.test(value)) return 'English'
  return undefined
}
