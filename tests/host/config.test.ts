// tests/host/config.test.ts
//
// 配置解析单测（resolveConfig）：默认值填充、null 默认键的显式补全，以及
// 退役配置键（旧部署 patch 中残留）的读取兼容——未知键既不抛错也不进入解析结果。
// 必填契约：apiKey / embeddingModelDir / embeddingEndpoint 声明为必填（string | null），
// 缺省解析必须显式产出 null（schemastery 不填 null 默认）。
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../../src/host/config.js'

// ---------------------------------------------------------------------------
// schema 默认值的表驱动覆盖
// ---------------------------------------------------------------------------

/** 子 schema 的最小结构（只取断言所需的类型与默认值）。 */
interface ConfigKeySchema {
  type?: string
  meta: { default?: unknown }
}

/** 读取 Config schema 声明的键表：默认值的唯一来源是 schema 本体，测试不复制默认值清单。 */
function configSchemaDict(): Record<string, ConfigKeySchema> {
  const schema = Config as unknown as { dict?: Record<string, ConfigKeySchema> }
  return schema.dict ?? {}
}

/** 按子 schema 类型生成一个合法显式取值（新增类型时在此补齐，否则用例显式失败而非静默跳过）。 */
function explicitSample(schema: ConfigKeySchema): unknown {
  switch (schema.type) {
    case 'number':
      return 7
    case 'string':
      return '显式值'
    case 'union':
      return '显式值'
    default:
      throw new Error(`未覆盖的配置键 schema 类型：${String(schema.type)}`)
  }
}

describe('resolveConfig：schema 默认值逐键填充', () => {
  it('缺省解析逐键落回 schema 默认值', () => {
    const dict = configSchemaDict()
    const keys = Object.keys(dict)
    expect(keys.length, 'schema 未声明任何配置键（用例会真空通过）').toBeGreaterThan(0)

    const resolved = resolveConfig({}) as unknown as Record<string, unknown>
    const filled: string[] = []
    const nullFilled: string[] = []
    for (const [key, schema] of Object.entries(dict)) {
      const declared = schema.meta.default
      if (declared === null) {
        // schemastery 对 null 默认不填充（Schema.resolve 遇 isNullable(fallback) 原样返回），
        // 而 Config 接口把这三个键声明为必填（`string | null`）：resolveConfig 必须显式补 null。
        // 缺键与 null 在接口层不等价——缺键会让「必填」声明在运行时失真（消费方只能靠 `?? null` 兜底）。
        expect(
          Object.prototype.hasOwnProperty.call(resolved, key),
          `${key} 缺省时必须显式存在（Config 接口声明为必填）`,
        ).toBe(true)
        expect(resolved[key], `${key} 缺省时必须为 null`).toBeNull()
        nullFilled.push(key)
        continue
      }
      expect(resolved, `${key} 缺省时应被 schema 默认值填充`).toHaveProperty(key)
      expect(resolved[key], `${key} 的缺省值应由 schema 决定`).toEqual(declared)
      filled.push(key)
    }
    // 聚合口径：schema 声明了非 null 默认值的键必须全部填充（防漏填导致逐个断言被跳过）
    expect(keys.filter((key) => dict[key].meta.default !== null).sort()).toEqual(filled.sort())
    // 聚合口径：null 默认键也必须全部显式落 null（遗漏键名不该被逐个断言掩盖）
    expect(keys.filter((key) => dict[key].meta.default === null).sort()).toEqual(nullFilled.sort())
  })

  it('显式给出的键逐键生效，缺省值不覆盖调用方取值', () => {
    const dict = configSchemaDict()
    const overrides: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(dict)) overrides[key] = explicitSample(schema)

    const resolved = resolveConfig(overrides as unknown as Partial<Config>) as unknown as Record<string, unknown>
    for (const key of Object.keys(dict)) {
      expect(resolved[key], `显式值被 schema 默认值覆盖：${key}`).toEqual(overrides[key])
    }
  })

  it('未知键：解析不抛错，也不影响已知键的缺省值填充', () => {
    const dict = configSchemaDict()
    const input = { 未知键: 1, unknownKey: 'x' } as unknown as Partial<Config>

    const resolved = resolveConfig(input) as unknown as Record<string, unknown>
    for (const [key, schema] of Object.entries(dict)) {
      if (schema.meta.default === null) continue
      expect(resolved[key], `未知键干扰了 ${key} 的缺省值`).toEqual(schema.meta.default)
    }
  })

  it('退役键（wf_ask_agent 时代的 TTL）：旧部署 patch 中残留不抛错（实测：schemastery 透传未知键）', () => {
    // 兼容契约：键已从 Config 接口与 schema 删除，既有部署的 cordis.patch 仍可能写着它。
    // 实测结论：schemastery 对未知键既不校验也不剥离（原样透传到解析结果），
    // 故升级不会让既有部署启动失败；透传值没有任何读取方（键已无消费者）。
    const resolved = resolveConfig({ wfAskAgentTtlMs: 120000, wfAskAgentTimeoutMs: 7000 } as never) as unknown as Record<string, unknown>
    expect(resolved.runIdleTimeoutMs, '已知键的缺省值不受未知键干扰').toBe(1800000)
    expect('wfAskAgentTtlMs' in resolved, '实测：未知键被透传而非剥离').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ReAct 迭代上限默认值
// ---------------------------------------------------------------------------

describe('resolveConfig：ReAct 迭代上限默认不设限', () => {
  it('缺省解析：reactIterationLimitDefault 为 0（0 = 不设限，插件不兜底私有上限）', () => {
    expect(resolveConfig({}).reactIterationLimitDefault).toBe(0)
  })

  it('显式配置的全局默认上限仍然生效（只改默认值，不废除可配置性）', () => {
    expect(resolveConfig({ reactIterationLimitDefault: 30 }).reactIterationLimitDefault).toBe(30)
  })
})
