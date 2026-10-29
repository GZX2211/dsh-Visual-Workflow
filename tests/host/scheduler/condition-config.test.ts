// tests/host/scheduler/condition-config.test.ts
//
// 条件触发纯规则（scheduler/condition-config.ts）：绝对路径判定 / 扩展名白名单 /
// stdout 最后一行的布尔判定。零 IO、无依赖注入。
//
// 为什么用动态导入：本文件是契约的前置红用例——模块尚未创建时，静态 import 会让整个
// 文件加载失败，看不出是哪条条款没实现；动态导入让每条用例各自给出「实现缺失」的失败，
// 模块建好后又无需改测试。

import { describe, expect, it } from 'vitest'

const MODULE_URL = new URL('../../../src/host/scheduler/condition-config.js', import.meta.url).href

interface ConditionConfigModule {
  isAbsoluteConditionScriptPath(value: string): boolean
  hasSupportedScriptExtension(value: string): boolean
  parseConditionOutput(lastLine: string): { pass: boolean; detail: string }
}

async function loadModule(): Promise<ConditionConfigModule> {
  return await import(/* @vite-ignore */ MODULE_URL) as unknown as ConditionConfigModule
}

describe('条件脚本路径：绝对路径判定（path.isAbsolute 语义，按运行平台）', () => {
  it('当前平台的绝对路径为 true', async () => {
    const mod = await loadModule()
    const values = process.platform === 'win32'
      ? ['C:\\scripts\\a.mjs', 'C:/scripts/a.mjs', '\\\\server\\share\\a.mjs']
      : ['/opt/scripts/a.mjs']
    for (const value of values) {
      expect(mod.isAbsoluteConditionScriptPath(value), value).toBe(true)
    }
  })

  it('相对路径与纯文件名为 false', async () => {
    const mod = await loadModule()
    for (const value of ['scripts/a.mjs', './a.mjs', 'a.mjs', '../a.mjs']) {
      expect(mod.isAbsoluteConditionScriptPath(value), value).toBe(false)
    }
    // Windows 反斜杠相对路径只在 win32 上是「相对」的另一写法
    if (process.platform === 'win32') {
      expect(mod.isAbsoluteConditionScriptPath('scripts\\a.mjs')).toBe(false)
    }
  })

  it('空串与仅空白为 false', async () => {
    const mod = await loadModule()
    expect(mod.isAbsoluteConditionScriptPath('')).toBe(false)
    expect(mod.isAbsoluteConditionScriptPath('   ')).toBe(false)
  })
})

describe('条件脚本路径：扩展名白名单', () => {
  it('.mjs / .cjs / .js 为 true，且大小写不敏感', async () => {
    const mod = await loadModule()
    for (const value of ['C:\\scripts\\a.mjs', 'C:\\scripts\\a.cjs', 'C:\\scripts\\a.js', 'C:\\scripts\\A.MJS', '/opt/a.CJS']) {
      expect(mod.hasSupportedScriptExtension(value), value).toBe(true)
    }
  })

  it('其它扩展名、无扩展名、双扩展名与末尾点为 false', async () => {
    const mod = await loadModule()
    for (const value of ['C:\\scripts\\a.ps1', 'C:\\scripts\\a.ts', 'C:\\scripts\\a.py', 'C:\\scripts\\a', 'C:\\scripts\\a.mjs.bak', 'C:\\scripts\\a.']) {
      expect(mod.hasSupportedScriptExtension(value), value).toBe(false)
    }
  })
})

describe('条件脚本输出：最后一行判定（纯文本，不看退出码）', () => {
  it('true（含大小写与首尾空白）→ pass，detail 为空', async () => {
    const mod = await loadModule()
    for (const value of ['true', 'TRUE', ' True ', 'true\n']) {
      expect(mod.parseConditionOutput(value), value).toEqual({ pass: true, detail: '' })
    }
  })

  it('false（含大小写与首尾空白）→ 不通过，detail 说明返回 false', async () => {
    const mod = await loadModule()
    for (const value of ['false', 'FALSE', '  False \n']) {
      const outcome = mod.parseConditionOutput(value)
      expect(outcome.pass, value).toBe(false)
      expect(outcome.detail.toLowerCase(), value).toContain('false')
    }
  })

  it('空输出与其它文本 → 不通过，detail 指明输出不是 true/false', async () => {
    const mod = await loadModule()
    for (const value of ['', '   ', 'true false', 'yes', '1']) {
      const outcome = mod.parseConditionOutput(value)
      expect(outcome.pass, value).toBe(false)
      expect(outcome.detail, value).toContain('true/false')
    }
  })

  it('判定只依赖入参文本（同一入参多次调用结果相同）', async () => {
    const mod = await loadModule()
    expect(mod.parseConditionOutput('true')).toEqual(mod.parseConditionOutput('true'))
    expect(mod.parseConditionOutput('')).toEqual(mod.parseConditionOutput(''))
  })
})
