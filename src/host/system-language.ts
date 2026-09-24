// src/host/system-language.ts
//
// 从 DSH 用户设置读取语言偏好（locale.preference），映射为面向模型的系统语言名。
//
// 需求背景（用户批注）：插件界面与提示词必须跟随官方配置的语言切换。官方在
// dsh-client-locale 中把语言偏好持久化在 profile 配置的 `locale` 命名空间下（字段
// `preference`，取值 BCP 47 风格，如 'zh' / 'en'）。
//
// 【0.1.7-rc.1 取证】官方 `settings` 服务（dsh-settings/lib/types/index.d.ts L62-117）
// **不再提供 `get(ns)`**——`SettingsForms` 只有 configure / writable / documentPath /
// prepareDocument / describe / update / replace / mutate。因此读取入口改为同步的
// `describe()`：返回 `SettingsDescriptor[]`（L8-19），每项 `ns` 为 profile entry id
// （实现 lib/index.js L432 `ns = entry.options.id`）、`value` 为该命名空间的实时解析值。
// locale 行的 entry id 固定为 `locale`（profile 组合层 `- id: locale`，见
// dsh-client-locale 的 LOCALE_SETTINGS_NAMESPACE），字段路径 `preference` 未变。
//
// 为什么不做缓存：`describe()` 是同步纯投影（遍历内存中的 configEditor 快照 +
// projectForm），且仅在配置原文变化时才 emit `settings/document-updated`
// （实现 lib/index.js L413-464），不会造成事件风暴；官方自身在 update/replace 路径内
// 也反复调用它，故此处直接读取，不引入第二份缓存事实。
//
// 本模块只做「读设置 → 映射语言名」的纯函数：settings 服务缺失、未注册 locale
// 命名空间或未显式选择语言时回退默认语言（中文，与插件默认中文界面一致）。
// 返回值供提示词构建器注入「所有回复必须使用 <语言>」规则（W-04 提示词正文中文，
// 但语言名本身是面向模型的取值）。

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
    const preference = String(locale?.value?.preference ?? '').trim().toLowerCase()
    if (preference.startsWith('zh')) return '中文'
    if (preference.startsWith('en')) return 'English'
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
