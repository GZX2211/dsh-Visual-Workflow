// T-001 包契约测试：校验 package.json 的 name/type/module 形态、exports 键齐全、
// dsh 元数据（bundle.patch / client）、依赖约束（W-05：零 @deepseek-ai/* 运行时依赖）、
// patch 文件形态，以及 files/exports 引用的静态文件在磁盘上真实存在。
//
// 运行环境：node（host 测试默认，不引入 jsdom）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录（package.json 所在目录）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 读取并解析根 package.json。 */
function readManifest(): Record<string, any> {
  const raw = readFileSync(resolve(root, 'package.json'), 'utf8')
  return JSON.parse(raw) as Record<string, any>
}

const pkg = readManifest()

/**
 * 判断 YAML 文本是否为「顶层数组」形态（不引入 yaml 解析依赖的最小语义校验）。
 * 兼容两种写法：流式 `[]` 占位，以及后续任务填充的块式序列（`- item` / `- key: val`）。
 * 处理方式：剔除 `#` 单行注释与空行后，剩余非空内容要么恰为 `[]`，要么每个顶层项都以
 * 行首 `- ` 开头（顶层序列项）。
 */
function isTopLevelArray(yamlText: string): boolean {
  const structural = yamlText
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, '').trimEnd())
    .filter((line) => line.trim().length > 0)
  if (structural.length === 0) return false
  // 流式占位：整段仅 `[]`。
  if (structural.length === 1 && structural[0] === '[]') return true
  // 块式序列：每个顶层项都是行首 `-`（允许缩进内的续行）。
  let sawItem = false
  for (const line of structural) {
    if (line.startsWith('-')) {
      sawItem = true
      continue
    }
    // 非 `-` 行只能是序列项的续行（如嵌套 key）。若首项尚未出现则不是顶层数组。
    if (!sawItem) return false
  }
  return sawItem
}

describe('T-001 包契约（package.json 基础形态）', () => {
  it('name 为 dsh-visual-workflow，version 0.1.0，type 为 module', () => {
    expect(pkg.name).toBe('dsh-visual-workflow')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.type).toBe('module')
  })

  it('main 指向 lib/index.js，types 指向 lib/types/index.d.ts', () => {
    expect(pkg.main).toBe('lib/index.js')
    expect(pkg.types).toBe('lib/types/index.d.ts')
  })
})

describe('T-001 包契约（exports 键齐全）', () => {
  it('exports 包含全部约定键', () => {
    const keys = Object.keys(pkg.exports ?? {}).sort()
    expect(keys).toEqual(
      ['./client', './cordis.patch.yml', './package.json', './serve.patch.yml', './service-runner', '.'].sort(),
    )
  })

  it('exports["."] 的 types 与 default 指向约定产物', () => {
    expect(pkg.exports['.']).toEqual({
      types: './lib/types/index.d.ts',
      default: './lib/index.js',
    })
  })

  it('exports["./client"] types 指向 lib/types/client/index.d.ts，default 指向 lib/client.js', () => {
    expect(pkg.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
  })

  it('exports["./service-runner"] default 指向 lib/service-runner.js', () => {
    expect(pkg.exports['./service-runner']).toEqual({ default: './lib/service-runner.js' })
  })

  it('exports 静态文件键指向根目录 patch 与 package.json', () => {
    expect(pkg.exports['./serve.patch.yml']).toBe('./serve.patch.yml')
    expect(pkg.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(pkg.exports['./package.json']).toBe('./package.json')
  })
})

describe('T-001 包契约（dsh 元数据）', () => {
  it('dsh.bundle.patch 指向 ./cordis.patch.yml', () => {
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })

  it('dsh.client.platform 为 web', () => {
    expect(pkg.dsh?.client?.platform).toBe('web')
  })

  it('dsh.client.inject 含 @deepseek-ai/dsh-client-runtime', () => {
    expect(pkg.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-runtime')
  })
})

describe('T-001 包契约（依赖约束，W-05）', () => {
  it('dependencies 中无任何 @deepseek-ai/* 运行时依赖', () => {
    const deps = Object.keys(pkg.dependencies ?? {})
    const deepseek = deps.filter((d) => d.startsWith('@deepseek-ai/'))
    expect(deepseek).toEqual([])
  })

  it('dependencies 仅含 @huggingface/transformers', () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@huggingface/transformers'])
  })

  it('peerDependencies 仅 @deepseek-ai/cordis', () => {
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual(['@deepseek-ai/cordis'])
  })
})

describe('T-001 包契约（patch 文件形态）', () => {
  it('cordis.patch.yml 存在且为顶层数组', () => {
    const p = resolve(root, 'cordis.patch.yml')
    expect(existsSync(p)).toBe(true)
    expect(isTopLevelArray(readFileSync(p, 'utf8'))).toBe(true)
  })

  it('serve.patch.yml 存在且为顶层数组', () => {
    const p = resolve(root, 'serve.patch.yml')
    expect(existsSync(p)).toBe(true)
    expect(isTopLevelArray(readFileSync(p, 'utf8'))).toBe(true)
  })
})

describe('T-001 包契约（files 与 exports 引用的静态文件存在）', () => {
  it('files 声明了约定的目录与静态文件', () => {
    const files = pkg.files as string[]
    for (const expected of [
      'lib',
      'cordis.patch.yml',
      'serve.patch.yml',
      'assets/models/bge-small-zh-v1.5',
      'README.md',
    ]) {
      expect(files).toContain(expected)
    }
  })

  it('files 引用的静态文件/目录在磁盘上存在', () => {
    const files = pkg.files as string[]
    for (const f of files) {
      expect(existsSync(resolve(root, f)), `files 条目缺失：${f}`).toBe(true)
    }
  })

  it('exports 引用的静态文件在磁盘上存在', () => {
    const staticTargets = [
      pkg.exports['./serve.patch.yml'],
      pkg.exports['./cordis.patch.yml'],
      pkg.exports['./package.json'],
    ] as string[]
    for (const t of staticTargets) {
      expect(existsSync(resolve(root, t)), `exports 入口缺失：${t}`).toBe(true)
    }
  })
})
