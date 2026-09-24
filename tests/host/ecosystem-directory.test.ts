// tests/host/ecosystem-directory.test.ts
//
// 官方生态枚举投影契约（src/host/ecosystem-directory.ts）：服务缺失与服务故障的
// 语义区分（返回 null / 空数组 vs 向上抛）、字段回退与单点降级规则。
//
// 这份契约被两个消费方共用（GUI 生态端点与自主编排勘察工具适配）；端点侧的降级
// 翻译见 tests/host/api/ecosystem.test.ts。

import { describe, expect, it } from 'vitest'
import { listAgentPresets, listEcosystemModels } from '../../src/host/ecosystem-directory.js'

/** 最小宿主缝（只实现 ctx.get）。 */
function ctxOf(services: Record<string, unknown>): { get(name: string): unknown } {
  return { get: (name: string) => services[name] }
}

describe('listAgentPresets', () => {
  it('agentPresets 服务缺失或形状不符 → null（由调用方决定降级，不在此吞成空清单）', async () => {
    expect(await listAgentPresets(ctxOf({}))).toBeNull()
    expect(await listAgentPresets(ctxOf({ agentPresets: {} }))).toBeNull()
    expect(await listAgentPresets(ctxOf({ agentPresets: { list: 'x' } }))).toBeNull()
  })

  it('broken 条目剔除；name/description/trust 按 metadata 与默认值回退', async () => {
    const presets = await listAgentPresets(ctxOf({
      agentPresets: {
        list: async () => [
          { id: 'p1', name: '标准' },
          { id: 'p2', metadata: { name: '元名', description: '元描述' }, trust: 'system' },
          { id: 'broken', broken: true },
        ],
      },
    }))
    expect(presets).toEqual([
      { id: 'p1', name: '标准', description: '', trust: 'user' },
      { id: 'p2', name: '元名', description: '元描述', trust: 'system' },
    ])
  })

  it('broken 为诊断字符串（0.1.7-rc.1 形态）时同样剔除', async () => {
    // 0.1.7-rc.1：官方 AgentPreset.broken 由布尔 true 改为 error.message 字符串；
    // 旧判定 `!== true` 会让这类激活失败的 preset 混入清单。
    const presets = await listAgentPresets(ctxOf({
      agentPresets: {
        list: async () => [
          { id: 'ok' },
          { id: 'broken-empty', broken: '' },
          { id: 'broken-msg', broken: '依赖的 Host 服务未装载' },
        ],
      },
    }))
    expect(presets).toEqual([{ id: 'ok', name: 'ok', description: '', trust: 'user' }])
  })

  it('list 故障向上抛（服务存在但读取失败属可诊断错误，不静默降级为空）', async () => {
    const ctx = ctxOf({ agentPresets: { list: async () => { throw new Error('boom') } } })
    await expect(listAgentPresets(ctx)).rejects.toThrow('boom')
  })
})

describe('listEcosystemModels', () => {
  it('llm 服务缺失 / listProviders 缺失 / listModels 缺失 → 空数组', async () => {
    expect(await listEcosystemModels(ctxOf({}))).toEqual([])
    expect(await listEcosystemModels(ctxOf({ llm: { listProviders: 'x' } }))).toEqual([])
    expect(await listEcosystemModels(ctxOf({ llm: { listProviders: () => ['p1'] } }))).toEqual([])
  })

  it('provider 按 id → name → 字符串回退解析；模型按 id → name → 字符串回退', async () => {
    const models = await listEcosystemModels(ctxOf({
      llm: {
        listProviders: () => ['str-provider', { id: 'id-provider' }, { name: 'name-provider' }, {}, null],
        listModels: async (provider: string) =>
          provider === 'str-provider' ? ['m-str', { id: 'm-id' }, { name: 'm-name' }, {}] : [{ id: `${provider}-m` }],
      },
    }))
    expect(models).toEqual([
      { provider: 'str-provider', model: 'm-str' },
      { provider: 'str-provider', model: 'm-id' },
      { provider: 'str-provider', model: 'm-name' },
      { provider: 'id-provider', model: 'id-provider-m' },
      { provider: 'name-provider', model: 'name-provider-m' },
    ])
  })

  it('单 provider 失败跳过其余；listProviders 抛错 → 空数组（best-effort 不阻断整体）', async () => {
    const models = await listEcosystemModels(ctxOf({
      llm: {
        listProviders: () => ['bad', 'good'],
        listModels: async (provider: string) => {
          if (provider === 'bad') throw new Error('boom')
          return ['m1']
        },
      },
    }))
    expect(models).toEqual([{ provider: 'good', model: 'm1' }])

    const throwing = ctxOf({ llm: { listProviders: () => { throw new Error('boom') }, listModels: async () => [] } })
    expect(await listEcosystemModels(throwing)).toEqual([])
  })

  it('思考强度按适配器公布透传并过滤空 id；未公布时省略该字段', async () => {
    const models = await listEcosystemModels(ctxOf({
      llm: {
        listProviders: () => ['p1'],
        listModels: async () => [{ id: 'm1', efforts: [{ id: 'high', name: '高' }, { id: '' }] }, { id: 'm2' }],
      },
    }))
    expect(models).toEqual([
      { provider: 'p1', model: 'm1', efforts: [{ id: 'high', name: '高' }] },
      { provider: 'p1', model: 'm2' },
    ])
  })
})
