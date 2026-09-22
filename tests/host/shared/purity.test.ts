// tests/host/shared/purity.test.ts
//
// 共享契约：纯度门（shared/AGENTS.md「纯度契约」）。
// 以源码文本断言锁定共享层可被 Host / Client 零风险引用：
//   1. 禁止运行时 import（仅允许 `import type` / `export type … from`，编译期擦除）；
//   2. 纯形状文件不得导出运行时值（运行时值只允许出现在 protocol.ts）；
//   3. 禁止动态 import / require / 全局可变状态声明等运行时逃逸形态。
//
// 为什么用文本断言而不是只靠 typecheck：shared 被两套独立 tsconfig program 同时引用，
// 任何运行时依赖都会污染另一侧的声明与 Context augmentation，属于跨 program 约束。
//
// 运行环境：node（host 测试默认）。

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录（tests/host/shared → 上三级）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sharedDir = resolve(root, 'src/host/shared')

/** 共享层源文件清单（按文件名排序，保证断言顺序确定；新增文件自动纳入门禁）。 */
const SHARED_FILES = readdirSync(sharedDir)
  .filter((name) => name.endsWith('.ts'))
  .sort()

/** 读取共享层源文件原文。 */
function readShared(name: string): string {
  return readFileSync(resolve(sharedDir, name), 'utf8')
}

/** 运行时常量文件（唯一允许导出运行时值的共享文件）。 */
const RUNTIME_CONSTANT_FILES = ['protocol.ts']

describe('shared 纯度门', () => {
  it('共享层至少包含本模块的契约文件（防止路径失效导致门禁空转）', () => {
    expect(SHARED_FILES).toContain('graph-model.ts')
    expect(SHARED_FILES).toContain('protocol.ts')
    expect(SHARED_FILES).toContain('types.ts')
  })

  it.each(SHARED_FILES)('%s 不含运行时 import（仅允许 import type）', (name) => {
    const lines = readShared(name).split(/\r?\n/)
    const runtimeImports = lines.filter((l) => /^import\s+(?!type\b)/.test(l.trim()))
    expect(runtimeImports, `${name} 存在运行时 import`).toEqual([])
  })

  it.each(SHARED_FILES)('%s 的模块说明符全部为 type-only 形态', (name) => {
    const specifierLines = readShared(name)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(import|export)\b/.test(line) && /\bfrom\s+['"]/.test(line))
    for (const line of specifierLines) {
      const isTypeOnly = line.startsWith('import type ') || line.startsWith('export type ')
      expect(isTypeOnly, `${name} 非 type 引用：${line}`).toBe(true)
    }
  })

  it.each(SHARED_FILES)('%s 不含动态 import / require 逃逸', (name) => {
    const src = readShared(name)
    expect(/[^.\w]import\s*\(/.test(src), `${name} 含动态 import()`).toBe(false)
    expect(/\brequire\s*\(/.test(src), `${name} 含 require()`).toBe(false)
  })

  it('纯形状文件不导出运行时值（export const/function/class/let 只允许出现在协议常量文件）', () => {
    for (const name of SHARED_FILES) {
      if (RUNTIME_CONSTANT_FILES.includes(name)) continue
      const src = readShared(name)
      const runtimeExports = src
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^export\s+(const|function|class|let|var|enum)\b/.test(line))
      expect(runtimeExports, `${name} 导出了运行时值（应移入协议常量文件）`).toEqual([])
    }
  })

  it('协议常量文件（protocol.ts）不导出可变运行时值（仅 as const 字面量常量与纯字面量数组）', () => {
    const src = readShared('protocol.ts')
    // 禁止 let / var / enum / class：协议常量层只放不可变字面量。
    const mutable = src
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^export\s+(let|var|enum|class)\b/.test(line))
    expect(mutable).toEqual([])
  })
})
