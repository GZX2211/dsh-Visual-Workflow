// tests/host/system-language.test.ts
//
// 系统语言读取纯函数单测（T-021 配套）：验证 systemLanguageOf 从 settings 服务
// 的 locale.preference 映射语言名，settings 缺失/未注册/未选择时回退默认语言。
//
// 【0.1.7-rc.1】官方 settings 服务不再提供 get(ns)，读取入口改为同步的 describe()：
// 返回 SettingsDescriptor[]（每项 { ns, value, ... }），故本测试的 fake 一律按该形状构造。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_LANGUAGE, isChineseSystemLanguage, systemLanguageOf } from '../../src/host/system-language.js'

/** 构造 settings 服务 fake：describe() 返回官方形状的描述符数组。 */
function settingsWithLocale(value: unknown): { describe: () => unknown } {
  return { describe: () => [{ ns: 'locale', value }] }
}

describe('systemLanguageOf（从 settings.describe() 读取系统语言名）', () => {
  it('locale.preference 为 zh → 中文', () => {
    expect(systemLanguageOf(settingsWithLocale({ preference: 'zh' }))).toBe('中文')
  })

  it('locale.preference 为 en → English', () => {
    expect(systemLanguageOf(settingsWithLocale({ preference: 'en' }))).toBe('English')
  })

  it('locale.preference 为 zh-CN / en-US（BCP 47 变体）前缀匹配', () => {
    expect(systemLanguageOf(settingsWithLocale({ preference: 'zh-CN' }))).toBe('中文')
    expect(systemLanguageOf(settingsWithLocale({ preference: 'en-US' }))).toBe('English')
  })

  it('settings 服务缺失 / describe 缺失 / 未选择语言 → 回退默认语言（中文）', () => {
    expect(systemLanguageOf(null)).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf(undefined)).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf({})).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf({ describe: () => undefined })).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf(settingsWithLocale(undefined))).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf(settingsWithLocale({}))).toBe(DEFAULT_SYSTEM_LANGUAGE)
  })

  it('describe 未返回数组 → 回退默认语言', () => {
    expect(systemLanguageOf({ describe: () => ({ ns: 'locale', value: { preference: 'en' } }) })).toBe(
      DEFAULT_SYSTEM_LANGUAGE,
    )
  })

  it('描述符中无 locale 命名空间（或 ns 非 locale）→ 回退默认语言', () => {
    expect(systemLanguageOf({ describe: () => [] })).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(
      systemLanguageOf({ describe: () => [{ ns: 'llm-deepseek', value: { preference: 'en' } }] }),
    ).toBe(DEFAULT_SYSTEM_LANGUAGE)
  })

  it('settings.describe 抛错 → 回退默认语言（防御式）', () => {
    expect(
      systemLanguageOf({
        describe: () => {
          throw new Error('boom')
        },
      }),
    ).toBe(DEFAULT_SYSTEM_LANGUAGE)
  })
})

describe('isChineseSystemLanguage', () => {
  it('中文开头判定为中文；English 判为非中文', () => {
    expect(isChineseSystemLanguage('中文')).toBe(true)
    expect(isChineseSystemLanguage('English')).toBe(false)
  })
})
