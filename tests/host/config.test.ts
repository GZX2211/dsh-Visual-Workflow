// tests/host/config.test.ts
//
// 配置解析单测（resolveConfig）：默认值填充、null 默认键的显式补全，与
// 「待回复登记 TTL」旧键名的读取兼容。
// 兼容契约：旧键 wfAskAgentTimeoutMs 仅在 >0 时投影到新键 wfAskAgentTtlMs，新键优先。
// 必填契约：apiKey / embeddingModelDir / embeddingEndpoint 声明为必填（string | null），
// 缺省解析必须显式产出 null（schemastery 不填 null 默认）。
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../../src/host/config.js'

describe('resolveConfig：wf_ask_agent TTL 键名迁移', () => {
  it('缺省：新键取默认 120000', () => {
    expect(resolveConfig({}).wfAskAgentTtlMs).toBe(120000)
  })

  it('新键生效', () => {
    expect(resolveConfig({ wfAskAgentTtlMs: 5000 }).wfAskAgentTtlMs).toBe(5000)
  })

  it('旧键（>0）读取兼容：投影到新键', () => {
    expect(resolveConfig({ wfAskAgentTimeoutMs: 7000 }).wfAskAgentTtlMs).toBe(7000)
  })

  it('两键同时给出：新键优先', () => {
    expect(resolveConfig({ wfAskAgentTtlMs: 5000, wfAskAgentTimeoutMs: 7000 }).wfAskAgentTtlMs).toBe(5000)
  })

  it('旧键为 0（未设置）不覆盖默认值', () => {
    expect(resolveConfig({ wfAskAgentTimeoutMs: 0 }).wfAskAgentTtlMs).toBe(120000)
  })
})

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
      // 退役键只读兼容、不写回（见下方单独断言），其余键必须原值生效
      if (key === 'wfAskAgentTimeoutMs') continue
      expect(resolved[key], `显式值被 schema 默认值覆盖：${key}`).toEqual(overrides[key])
    }
    expect(resolved.wfAskAgentTimeoutMs, '退役键不得写回解析结果').toBe(0)
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
})
