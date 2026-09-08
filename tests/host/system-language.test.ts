// tests/host/system-language.test.ts
//
// 系统语言读取纯函数单测（T-021 配套）：验证 systemLanguageOf 从 settings 服务
// 的 locale.preference 映射语言名，settings 缺失/未注册/未选择时回退默认语言。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_LANGUAGE, isChineseSystemLanguage, systemLanguageOf } from '../../src/host/system-language.js'

describe('systemLanguageOf（从 settings 读取系统语言名）', () => {
  it('locale.preference 为 zh → 中文', () => {
    const settings = { get: (ns: string) => (ns === 'locale' ? { preference: 'zh' } : undefined) }
    expect(systemLanguageOf(settings)).toBe('中文')
  })

  it('locale.preference 为 en → English', () => {
    const settings = { get: (ns: string) => (ns === 'locale' ? { preference: 'en' } : undefined) }
    expect(systemLanguageOf(settings)).toBe('English')
  })

  it('locale.preference 为 zh-CN / en-US（BCP 47 变体）前缀匹配', () => {
    expect(systemLanguageOf({ get: () => ({ preference: 'zh-CN' }) })).toBe('中文')
    expect(systemLanguageOf({ get: () => ({ preference: 'en-US' }) })).toBe('English')
  })

  it('settings 服务缺失 / locale 未注册 / 未选择语言 → 回退默认语言（中文）', () => {
    expect(systemLanguageOf(null)).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf(undefined)).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf({})).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf({ get: () => undefined })).toBe(DEFAULT_SYSTEM_LANGUAGE)
    expect(systemLanguageOf({ get: () => ({}) })).toBe(DEFAULT_SYSTEM_LANGUAGE)
  })

  it('settings.get 抛错 → 回退默认语言（防御式）', () => {
    expect(systemLanguageOf({ get: () => { throw new Error('boom') } })).toBe(DEFAULT_SYSTEM_LANGUAGE)
  })
})

describe('isChineseSystemLanguage', () => {
  it('中文开头判定为中文；English 判为非中文', () => {
    expect(isChineseSystemLanguage('中文')).toBe(true)
    expect(isChineseSystemLanguage('English')).toBe(false)
  })
})
