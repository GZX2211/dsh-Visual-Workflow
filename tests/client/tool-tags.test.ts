// tests/client/tool-tags.test.ts
//
// 组合管理筛选标签纯逻辑单测：动态 MCP 服务器 Tag 提取 / 构建顺序 / 标签过滤。

import { describe, expect, it } from 'vitest'
import {
  buildToolTags,
  filterToolNamesByTag,
  mcpServerOfToolName,
  TAG_ALL,
  TAG_BUILTIN,
  toolBelongsToServer,
} from '../../src/client/lib/tool-tags.js'

const TOOL_NAMES = [
  'read',
  'wf_run_node',
  'mcp__codegraph__codegraph_explore',
  'mcp__codegraph__codegraph_get_related_symbols',
  'mcp__playwright_mcp__page_screenshot',
  'mcp__playwright_mcp__browser_click',
]

describe('mcpServerOfToolName', () => {
  it('解析 mcp__<server>__ 的中间段', () => {
    expect(mcpServerOfToolName('mcp__codegraph__codegraph_explore')).toBe('codegraph')
    expect(mcpServerOfToolName('mcp__playwright_mcp__page_screenshot')).toBe('playwright_mcp')
  })

  it('非 MCP / 无第二段返回 null', () => {
    expect(mcpServerOfToolName('read')).toBeNull()
    expect(mcpServerOfToolName('mcp__only')).toBeNull()
    expect(mcpServerOfToolName('')).toBeNull()
  })
})

describe('toolBelongsToServer', () => {
  it('前缀匹配', () => {
    expect(toolBelongsToServer('mcp__codegraph__codegraph_explore', 'codegraph')).toBe(true)
    expect(toolBelongsToServer('read', 'codegraph')).toBe(false)
    expect(toolBelongsToServer('mcp__codegraph__x', 'codegraph_2')).toBe(false)
  })
})

describe('buildToolTags', () => {
  it('标签顺序：全部 → 官方工具 → 动态 MCP（首次出现顺序）', () => {
    const tags = buildToolTags(TOOL_NAMES)
    expect(tags.map((t) => t.key)).toEqual([
      TAG_ALL,
      TAG_BUILTIN,
      'mcp:codegraph',
      'mcp:playwright_mcp',
    ])
    expect(tags[0].label).toBe('全部')
    expect(tags[1].label).toBe('官方工具')
  })

  it('新 server 工具出现时自动追加 Tag（动态性）', () => {
    const tags = buildToolTags([...TOOL_NAMES, 'mcp__fresh_server__new_tool'])
    expect(tags.map((t) => t.key)).toContain('mcp:fresh_server')
  })

  it('标签显示优先已配置 serverName（规范化反查），否则用解析命名空间', () => {
    const tags = buildToolTags(TOOL_NAMES, [
      { serverName: 'codegraph' },
      { serverName: 'playwright' }, // 未命中（实际命名空间 playwright_mcp）
    ])
    const codegraph = tags.find((t) => t.key === 'mcp:codegraph')
    const playwright = tags.find((t) => t.key === 'mcp:playwright_mcp')
    expect(codegraph?.label).toBe('codegraph')
    expect(playwright?.label).toBe('playwright_mcp')
  })

  it('服务名含非法字符：命名空间规范化反查回配置原名', () => {
    const tags = buildToolTags(['mcp__my_server__tool_a'], [{ serverName: 'my server' }])
    expect(tags.map((t) => t.key)).toContain('mcp:my_server')
    expect(tags.find((t) => t.kind === 'mcp')?.label).toBe('my server')
  })

  it('空目录：仅 全部 + 官方工具', () => {
    expect(buildToolTags([]).map((t) => t.key)).toEqual([TAG_ALL, TAG_BUILTIN])
  })
})

describe('filterToolNamesByTag', () => {
  it('全部：原样保留', () => {
    expect(filterToolNamesByTag(TOOL_NAMES, TAG_ALL)).toEqual(TOOL_NAMES)
  })

  it('官方工具：仅非 MCP', () => {
    expect(filterToolNamesByTag(TOOL_NAMES, TAG_BUILTIN)).toEqual(['read', 'wf_run_node'])
  })

  it('MCP Tag：仅该服务器工具', () => {
    expect(filterToolNamesByTag(TOOL_NAMES, 'mcp:codegraph')).toEqual([
      'mcp__codegraph__codegraph_explore',
      'mcp__codegraph__codegraph_get_related_symbols',
    ])
    expect(filterToolNamesByTag(TOOL_NAMES, 'mcp:playwright_mcp')).toEqual([
      'mcp__playwright_mcp__page_screenshot',
      'mcp__playwright_mcp__browser_click',
    ])
  })
})
