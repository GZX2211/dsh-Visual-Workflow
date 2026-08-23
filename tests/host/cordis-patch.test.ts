// T-002 测试：cordis.patch.yml 的 insert 行与 src/host/index.ts 最小宿主入口骨架。
//
// 覆盖：
//   1. cordis.patch.yml 文本断言——顶层 `- insert:`、id/name 正确、全部 config 键
//      齐全且值正确（servicePortBase=7860 等）、dataDir 为 `!!js dshHomePath('visual-workflow')`。
//   2. src/host/index.ts 文本断言——导出 name/inject/apply、Config schema、
//      visualWorkflowHost Service 占位（Service.init 日志 + dispose 清理 + T-015 TODO）。
//
// 说明：为不引入额外运行期（jsdom/yaml 解析），本测试直接对两个源文件做**文本级**断言
// （t-001 的 package-contract.test.ts 同款最小语义校验思路），并做一次编译产物的
// 「可被 Loader 导出」烟雾断言（若 lib/index.js 已存在）。
//
// 重要说明（键数）：架构文档 §2.2 的 config 块为 13 个键（L75-87）；任务描述中的
// 「14 个键」系笔误，本测试以架构文档 §2.2 逐字列表为准（13 键）。
//
// 运行环境：node（host 测试默认）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录（package.json 所在目录）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 读取根 cordis.patch.yml 原文。 */
const patchText = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
/** 读取宿主入口源码原文（勿运行时 import，避免对构建产物时序产生硬依赖）。 */
const entryText = readFileSync(resolve(root, 'src/host/index.ts'), 'utf8')

// 架构文档 §2.2 的 13 个 config 键 → 文本级期望值。
//   key: 期望出现的「键: 值」片段（弱匹配，容忍 !!js 标签；null 值匹配字面 null）。
const CONFIG_KEYS: Array<[string, string]> = [
  ['dataDir', "dshHomePath('visual-workflow')"],
  ['servicePortBase', '7860'],
  ['apiKey', 'null'],
  ['maxConcurrentPerService', '50'],
  ['wfAskAgentTimeoutMs', '120000'],
  ['runIdleTimeoutMs', '1800000'],
  ['runPollMs', '2000'],
  ['reactIterationLimitDefault', '50'],
  ['retryLimitDefault', '3'],
  ['outputFullLimit', '102400'],
  ['documentTextLimit', '20000'],
  ['embeddingModelDir', 'null'],
  ['embeddingEndpoint', 'null'],
]

describe('T-002 cordis.patch.yml（insert 行语义）', () => {
  it('顶层为 insert 块数组，含 id=visual-workflow 与 name=dsh-visual-workflow', () => {
    expect(patchText).toContain('- insert:')
    expect(patchText).toMatch(/id:\s*visual-workflow\b/)
    expect(patchText).toMatch(/name:\s*dsh-visual-workflow\b/)
  })

  it('字段顺序 id → name → config', () => {
    const idIdx = patchText.indexOf('id: visual-workflow')
    const nameIdx = patchText.indexOf('name: dsh-visual-workflow')
    const configIdx = patchText.indexOf('config:')
    expect(idIdx).toBeGreaterThan(-1)
    expect(nameIdx).toBeGreaterThan(idIdx)
    expect(configIdx).toBeGreaterThan(nameIdx)
  })

  it('dataDir 使用 !!js dshHomePath(\'visual-workflow\')', () => {
    expect(patchText).toMatch(/dataDir:\s*!!js\s+dshHomePath\('visual-workflow'\)/)
  })

  it('全部 13 个 config 键齐全且值正确', () => {
    for (const [key, rawValue] of CONFIG_KEYS) {
      if (rawValue === 'null') {
        expect(patchText, `config 键值不符：${key}`).toMatch(new RegExp(`${key}:\\s*null`))
        continue
      }
      // dataDir 带 !!js 标签（且括号需转义）；其余数值键不带标签。
      const value =
        key === 'dataDir'
          ? `!!js\\s+dshHomePath\\('visual-workflow'\\)`
          : rawValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(patchText, `config 键值不符：${key}`).toMatch(new RegExp(`${key}:\\s*${value}`))
    }
  })
})

describe('T-002 src/host/index.ts（最小宿主入口骨架）', () => {
  it('导出 name = dsh-visual-workflow 与空 inject 数组', () => {
    expect(entryText).toMatch(/export const name = 'dsh-visual-workflow'/)
    expect(entryText).toMatch(/export const inject: string\[\] = \[\]/)
  })

  it('导出 apply(ctx, config) 与 Config schema（z.object + 13 键默认值）', () => {
    expect(entryText).toMatch(/export function apply\(ctx: Context, config: Config\)/)
    expect(entryText).toMatch(/export const Config: z<Config> = z\.object\(\{/)
    for (const [key] of CONFIG_KEYS) {
      expect(entryText, `schema 缺少键：${key}`).toMatch(new RegExp(`${key}:`))
    }
    // 关键数值默认值与 patch 逐字一致。
    const numericDefaults: Array<[string, number]> = [
      ['servicePortBase', 7860],
      ['maxConcurrentPerService', 50],
      ['wfAskAgentTimeoutMs', 120000],
      ['runIdleTimeoutMs', 1800000],
      ['runPollMs', 2000],
      ['reactIterationLimitDefault', 50],
      ['retryLimitDefault', 3],
      ['outputFullLimit', 102400],
      ['documentTextLimit', 20000],
    ]
    for (const [key, value] of numericDefaults) {
      expect(entryText, `schema 默认值不符：${key}`).toMatch(
        new RegExp(`${key}:\\s*z\\.natural\\(\\)\\.default\\(${value}\\)`),
      )
    }
    // 三个可空键：string|null 并默认 null。
    for (const key of ['apiKey', 'embeddingModelDir', 'embeddingEndpoint']) {
      expect(entryText, `schema 可空键形态不符：${key}`).toMatch(
        new RegExp(`${key}:\\s*z\\.union\\(\\[z\\.string\\(\\),\\s*z\\.const\\(null\\)\\]\\)\\.default\\(null\\)`),
      )
    }
  })

  it('提供 visualWorkflowHost Service 占位（Service.init 日志 + dispose 清理 + T-015 TODO）', () => {
    expect(entryText).toMatch(/class VisualWorkflowHost extends Service/)
    expect(entryText).toMatch(/super\(ctx, VisualWorkflowHostServiceName\)/)
    expect(entryText).toMatch(/async \[Service\.init\]\(\): Promise<void>/)
    expect(entryText).toMatch(/T-015/)
    expect(entryText).toMatch(/ctx\.effect/)
    expect(entryText).toMatch(/visualWorkflowHost\.dispose/)
  })

  it('从 @deepseek-ai/schemastery 默认导入 z（非 zod）', () => {
    expect(entryText).toMatch(/import z from '@deepseek-ai\/schemastery'/)
  })
})

describe('T-002 编译产物可被 import（可选烟雾，取决于是否已构建）', () => {
  it('lib/index.js 存在时导出 name/inject/apply/Config', async () => {
    const libIndex = resolve(root, 'lib/index.js')
    if (!existsSync(libIndex)) {
      // 未构建时跳过（build 发生在验证阶段）；避免测试对构建时序产生硬依赖。
      expect(true).toBe(true)
      return
    }
    const mod = (await import(libIndex)) as Record<string, unknown>
    expect(mod.name).toBe('dsh-visual-workflow')
    expect(Array.isArray(mod.inject)).toBe(true)
    expect(typeof mod.apply).toBe('function')
    // schemastery 的 schema 是可调用函数（z.object 返回 Schema，函数对象），非普通对象。
    expect(typeof mod.Config).toBe('function')
  })
})
