// tests/host/orchestrator/reflection-removed.test.ts
//
// 旧 Reflection 链退役守卫：删除的模块不可再导入、公共入口不再导出复盘注入面。
// 为什么用存在性守卫而不是导入断言：模块已删除，任何 import 都是编译期错误，
// 只有显式检查文件已消失才能锁住「旧链不得复活」。

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as orchestrator from '../../../src/host/orchestrator/index.js'
import * as prompts from '../../../src/host/prompts/index.js'

/** 源码相对仓库根目录的绝对路径。 */
function sourcePath(relative: string): string {
  return fileURLToPath(new URL(`../../../${relative}`, import.meta.url))
}

describe('旧 Reflection 链已退役', () => {
  it('复盘注入模块与文案模块的文件已删除', () => {
    expect(existsSync(sourcePath('src/host/orchestrator/runtime-reflection.ts'))).toBe(false)
    expect(existsSync(sourcePath('src/host/prompts/reflection.ts'))).toBe(false)
  })

  it('orchestrator 公共入口不再导出复盘注入面', () => {
    for (const name of ['injectReflection', 'reflectionFactsOf', 'REFLECTION_MESSAGE_SOURCE']) {
      expect(Object.hasOwn(orchestrator, name)).toBe(false)
    }
  })

  it('prompts 公共入口不再导出复盘文案面', () => {
    for (const name of ['buildReflectionPrompt', 'REFLECTION_MARKER', 'REFLECTION_MAX_EXPERIENCES', 'REFLECTION_TOOL_NAME']) {
      expect(Object.hasOwn(prompts, name)).toBe(false)
    }
  })
})
