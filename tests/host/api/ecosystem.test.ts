// tests/host/api/ecosystem.test.ts
//
// 生态枚举端点组的边界职责（api/ecosystem.ts）：官方服务缺失/失败时的降级与
// 响应形状；preset/模型投影的单一来源行为（ecosystem-directory）。
//
// pluginCatalog 用例经 DSH_HOME 指向临时目录（MCP 行来自 profile 托管区）。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanupAll, makeHarness, snapshotDshHome } from './fixtures/api-harness.js'

const restoreDshHome = snapshotDshHome()

/**
 * `Symbol.asyncDispose` 的运行时取值。
 * 为什么经断言取值：测试 program 的 lib 与 host program 一致（es2022，不含
 * esnext.disposable），直接书写 `Symbol.asyncDispose` 无法通过类型检查。
 */
const ASYNC_DISPOSE = (Symbol as unknown as { asyncDispose: symbol }).asyncDispose

afterEach(async () => {
  await cleanupAll()
  restoreDshHome()
})

describe('生态端点', () => {
  it('presets/tools/models：fake 服务解析；缺失返回空', async () => {
    const h = await makeHarness()
    expect(await h.api.handle('presets', {})).toEqual([])
    expect(await h.api.handle('tools', {})).toEqual([])
    expect(await h.api.handle('models', {})).toEqual([])

    h.ctx.services.set('agentPresets', {
      list: async () => [
        { id: 'standard', name: '标准模式', description: '默认' },
        // 0.1.7-rc.1：broken 为诊断字符串（0.1.5 曾为布尔 true）——两种形态都应剔除
        { id: 'broken-one', broken: '依赖的 Host 服务未装载' },
      ],
    })
    const presets = (await h.api.handle('presets', {})) as Array<{ id?: string }>
    expect(presets).toHaveLength(1)
    expect(presets[0].id).toBe('standard')

    h.ctx.services.set('tools', {
      schemas: () => [{ name: 'read', description: 'Read a file.' }, { title: 'write' }],
    })
    const tools = (await h.api.handle('tools', {})) as Array<{ name?: string }>
    expect(tools.map((t) => t.name).sort()).toEqual(['read', 'write'])

    h.ctx.services.set('llm', {
      listProviders: () => ['p1'],
      listModels: async () => ['m1', { id: 'm2', name: '模型二' }],
    })
    const models = (await h.api.handle('models', {})) as Array<{ provider?: string; model?: string }>
    expect(models).toEqual([
      { provider: 'p1', model: 'm1' },
      { provider: 'p1', model: 'm2' },
    ])
  })

  it('models：思考强度档位随适配器公布透传；未公布时省略该字段', async () => {
    const h = await makeHarness()
    h.ctx.services.set('llm', {
      listProviders: () => ['p1'],
      listModels: async () => [
        { id: 'm-effort', efforts: [{ id: 'high', name: '高' }, { id: '', name: '空' }] },
        { id: 'm-plain' },
      ],
    })
    const models = (await h.api.handle('models', {})) as Array<{ model?: string; efforts?: Array<{ id: string; name: string }> }>
    expect(models).toEqual([
      { provider: 'p1', model: 'm-effort', efforts: [{ id: 'high', name: '高' }] },
      { provider: 'p1', model: 'm-plain' },
    ])
  })

  it('pluginCatalog：工具并集（全局 + preset standing）+ 中文描述 + MCP 行', async () => {
    const h = await makeHarness()
    const mcpDir = join(h.dataDir, 'dsh-home')
    process.env.DSH_HOME = mcpDir
    await mkdir(join(mcpDir, 'profiles', 'web'), { recursive: true })
    await writeFile(
      join(mcpDir, 'profiles', 'web', 'cordis.patch.yml'),
      '# >>> dsh-visual-workflow\n- insert:\n    - id: mcp-demo\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        serverName: demo\n        transport: stdio\n        command: npx\n        args:\n          - "-y"\n          - demo-server\n# <<< dsh-visual-workflow\n',
      'utf8',
    )
    const presetKey = { presetScope: true }
    let leaseReleased = 0
    h.ctx.services.set('agentPresets', {
      list: async () => [{ id: 'standard' }],
      // 0.1.7-rc.1：standing scope 经 acquireScope 取引用租约，读完必须经
      // Symbol.asyncDispose 释放（standingKeyFor 已从官方移除）
      acquireScope: async () => ({
        key: presetKey,
        [ASYNC_DISPOSE]: async () => {
          leaseReleased += 1
        },
      }),
    })
    h.ctx.services.set('tools', {
      schemas: (scope?: unknown) =>
        scope === undefined
          ? [{ name: 'wf_run_node', description: 'Start a node.' }]
          : scope === presetKey
            ? [{ name: 'read', description: 'Read a file.' }, { name: 'mcp__demo__fetch', description: 'Fetch.' }]
            : [],
    })
    const catalog = (await h.api.handle('pluginCatalog', {})) as {
      items: Array<{ key: string; name: string; description: string; source: string }>
      mcp: Array<{ id: string }>
    }
    const names = catalog.items.map((item) => item.name).sort()
    expect(names).toEqual(['mcp__demo__fetch', 'read', 'wf_run_node'])
    const read = catalog.items.find((item) => item.name === 'read')
    expect(read?.description).toContain('读取文件')
    expect(catalog.mcp[0]).toMatchObject({ id: 'mcp-demo' })
    // standing scope 租约必须被释放（引用计数回收），否则 preset scope 常驻
    expect(leaseReleased).toBe(1)
  })
})
