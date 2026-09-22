// tests/host/api/catalog.test.ts
//
// 组合管理与插件目录端点组的边界职责（api/catalog.ts）：工具组合 CRUD 校验、
// 全局工具开关批量端点（含跨进程刷新口径）、MCP 托管区读写往返。
//
// MCP 用例经 DSH_HOME 指向临时目录（托管区落在 profile 的 cordis.patch.yml）。

import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ToolSwitchStore } from '../../../src/host/tools/infrastructure/tool-switches.js'
import { cleanupAll, makeHarness, snapshotDshHome } from './fixtures/api-harness.js'

const restoreDshHome = snapshotDshHome()

afterEach(async () => {
  await cleanupAll()
  restoreDshHome()
})

describe('组合端点', () => {
  it('toolComboPut 校验 combo- 前缀；CRUD 往返', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('toolComboPut', { combo: { id: 'bad', name: 'x' } })).rejects.toMatchObject({ status: 400 })
    const saved = await h.api.handle('toolComboPut', {
      combo: { id: 'combo-1', name: '研发组合', tools: ['read', 'write'], mcpServers: ['mcp-a'] },
    })
    expect((saved as { id?: string }).id).toBe('combo-1')
    const list = (await h.api.handle('toolCombos', {})) as unknown[]
    expect(list).toHaveLength(1)
    const deleted = await h.api.handle('toolComboDelete', { id: 'combo-1' })
    expect(deleted).toEqual({ deleted: true })
  })
})

describe('全局工具开关批量端点', () => {
  it('toolSwitchPutMany：批量关闭并返回更新后清单；再次批量开启移出', async () => {
    const h = await makeHarness()
    h.host.toolSwitches = new ToolSwitchStore(h.dataDir)
    await h.host.toolSwitches.load()

    const closed = (await h.api.handle('toolSwitchPutMany', { names: ['read', 'grep', ''], disabled: true })) as { disabled?: string[] }
    expect(closed.disabled?.sort()).toEqual(['grep', 'read'])

    const opened = (await h.api.handle('toolSwitchPutMany', { names: ['read', 'grep'], disabled: false })) as { disabled?: string[] }
    expect(opened.disabled).toEqual([])
    expect(await h.host.toolSwitches.readDisabled()).toEqual([])
  })

  it('toolSwitchPutMany：空集合 / 官方保留传输名过滤后为空 → 400', async () => {
    const h = await makeHarness()
    h.host.toolSwitches = new ToolSwitchStore(h.dataDir)
    await h.host.toolSwitches.load()
    await expect(h.api.handle('toolSwitchPutMany', { names: [], disabled: true })).rejects.toThrow(/一个以上/)
    await expect(h.api.handle('toolSwitchPutMany', { names: ['  '], disabled: true })).rejects.toThrow(/一个以上/)
    // 官方保留传输名 run_code 不可关闭：过滤后为空 → 400（不误伤）
    await expect(h.api.handle('toolSwitchPutMany', { names: ['run_code'], disabled: true })).rejects.toThrow(/一个以上/)
  })

  it('toolSwitchPutMany：toolSwitches 能力缺失 → 501', async () => {
    const h = await makeHarness()
    await expect(h.api.handle('toolSwitchPutMany', { names: ['read'], disabled: true })).rejects.toThrow(/tool switches unavailable/)
  })

  it('toolSwitches/pluginCatalog：生效态口径一致（跨进程刷新，含自主编排两工具默认开启）', async () => {
    const h = await makeHarness()
    h.host.toolSwitches = new ToolSwitchStore(h.dataDir)
    await h.host.toolSwitches.load()
    // 默认全部开启：自主编排两工具不再被种子隐藏（历史 BUG：界面显示已开启、上下文被隐藏）
    const initial = (await h.api.handle('toolSwitches', {})) as { disabled?: string[] }
    expect(initial.disabled).toEqual([])
    // 另一进程（同一 dataDir 的第二个 store 实例）关闭 wf_graph_patch：
    // 本进程端点必须经 effectiveDisabled 先刷新，再返回，不得返回过期快照
    const other = new ToolSwitchStore(h.dataDir)
    await other.load()
    await other.setDisabled('wf_graph_patch', true)
    expect(h.host.toolSwitches.currentDisabled().has('wf_graph_patch')).toBe(false)
    const after = (await h.api.handle('toolSwitches', {})) as { disabled?: string[] }
    expect(after.disabled).toEqual(['wf_graph_patch'])
    expect(h.host.toolSwitches.currentDisabled().has('wf_graph_patch')).toBe(true)
    // pluginCatalog 的 disabledTools 与 toolSwitches 同源（同一生效态读取路径）
    const catalog = (await h.api.handle('pluginCatalog', {})) as { disabledTools?: string[] }
    expect(catalog.disabledTools).toEqual(['wf_graph_patch'])
  })
})

describe('MCP 端点', () => {
  it('mcpPut/mcpList/mcpToggle/mcpDelete：托管区读写往返', async () => {
    const h = await makeHarness()
    const mcpDir = join(h.dataDir, 'dsh-home')
    process.env.DSH_HOME = mcpDir
    const patch = join(mcpDir, 'profiles', 'web', 'cordis.patch.yml')

    const saved = (await h.api.handle('mcpPut', {
      server: { id: 'mcp-demo', serverName: 'demo', transport: 'stdio', command: 'npx -y demo-server', args: ['--port', '9000'] },
    })) as { id?: string; serverName?: string; command?: string; args?: string[] }
    expect(saved.id).toBe('mcp-demo')
    // Windows 下 npx 是 .cmd 包装，Node≥20.12 不能直接 spawn → 展开为 cmd.exe /c
    const isWin = process.platform === 'win32'
    expect(saved.command).toBe(isWin ? 'cmd.exe' : 'npx')
    expect(saved.args).toEqual(isWin
      ? ['/d', '/c', 'npx', '-y', 'demo-server', '--port', '9000']
      : ['-y', 'demo-server', '--port', '9000'])

    const list = (await h.api.handle('mcpList', {})) as Array<{ id?: string }>
    expect(list).toHaveLength(1)

    // 托管区已写入 profile（YAML 单引号标量：反斜杠/路径字面量，避免双重转义事故）
    const text = await readFile(patch, 'utf8')
    expect(text).toContain('# >>> dsh-visual-workflow')
    expect(text).toContain("serverName: 'demo'")

    await h.api.handle('mcpToggle', { id: 'mcp-demo', disabled: true })
    const toggled = (await h.api.handle('mcpList', {})) as Array<{ disabled?: boolean }>
    expect(toggled[0].disabled).toBe(true)

    const removed = await h.api.handle('mcpDelete', { id: 'mcp-demo' })
    expect(removed).toEqual({ deleted: true })
    expect(await h.api.handle('mcpList', {})).toEqual([])
  })
})
