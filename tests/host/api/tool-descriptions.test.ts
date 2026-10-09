// tests/host/api/tool-descriptions.test.ts
//
// 组合管理卡片描述映射（api/tool-descriptions.ts）：中/英键对称、中文短描述命中、
// 英文短描述命中且不加 [EN] 前缀、未命中回退与占位、长度截断。

import { describe, expect, it } from 'vitest'
import { CARD_DESC_MAX, TOOL_EN, TOOL_ZH, toolCardDescription } from '../../../src/host/api/tool-descriptions.js'
import {
  WF_EXPERIENCE_FEEDBACK,
  WF_EXPERIENCE_LEARN,
  WF_EXPERIENCE_RECALL,
} from '../../../src/host/shared/protocol.js'

describe('组合管理卡片描述（toolCardDescription）', () => {
  const longEnglish = 'Apply one patch to a workflow template or the running instance. This tool has three op groups. '.repeat(8)

  it('中/英映射键完全对称（新增工具必须同时补两种语言）', () => {
    expect(Object.keys(TOOL_EN).sort()).toEqual(Object.keys(TOOL_ZH).sort())
    expect(Object.keys(TOOL_ZH).length).toBeGreaterThan(20)
  })

  it('自主编排两工具命中中文短描述（不再回退超长英文撑破卡片）', () => {
    expect(toolCardDescription('wf_graph_patch', longEnglish, true)).toBe('改写工作流图（图结构 / 里程碑标记，一次补丁仅一组）；仅父代理可用')
    expect(toolCardDescription('wf_org_catalog', longEnglish, true)).toContain('只读勘察组织资产')
    expect(toolCardDescription('wf_org_catalog', longEnglish, true).length).toBeLessThanOrEqual(CARD_DESC_MAX)
  })

  it('经验三工具均命中中文短描述（新工具不得回退成截断的英文卡片）', () => {
    for (const name of [WF_EXPERIENCE_LEARN, WF_EXPERIENCE_RECALL, WF_EXPERIENCE_FEEDBACK]) {
      const text = toolCardDescription(name, longEnglish, true)
      expect(text.startsWith('[EN] ')).toBe(false)
      expect(text.length).toBeLessThanOrEqual(CARD_DESC_MAX)
    }
    expect(toolCardDescription(WF_EXPERIENCE_FEEDBACK, longEnglish, true)).toContain('评价')
  })

  it('未命中：中文原文照用；英文加 [EN] 前缀并按 CARD_DESC_MAX 截断；空描述有占位', () => {
    expect(toolCardDescription('unknown-tool', '读取文件', true)).toBe('读取文件')
    const clipped = toolCardDescription('unknown-tool', longEnglish, true)
    expect(clipped.startsWith('[EN] ')).toBe(true)
    expect(clipped.length).toBe(CARD_DESC_MAX)
    expect(clipped.endsWith('…')).toBe(true)
    expect(toolCardDescription('unknown-tool', '', true)).toBe('（暂无描述）')
  })

  it('英文界面：命中 TOOL_EN 短英文（无 [EN] 前缀、无中文、不超卡片上限）', () => {
    for (const name of [WF_EXPERIENCE_LEARN, WF_EXPERIENCE_RECALL, WF_EXPERIENCE_FEEDBACK, 'wf_graph_patch', 'read']) {
      const text = toolCardDescription(name, longEnglish, false)
      expect(text.startsWith('[EN] ')).toBe(false)
      expect(/[\u4e00-\u9fa5]/.test(text)).toBe(false)
      expect(text.length).toBeLessThanOrEqual(CARD_DESC_MAX)
    }
    expect(toolCardDescription('wf_org_catalog', longEnglish, false)).toContain('Read-only survey')
  })

  it('英文界面未命中：schema 原文照用（不加 [EN] 前缀）；空描述用英文占位', () => {
    expect(toolCardDescription('unknown-tool', 'Apply a patch', false)).toBe('Apply a patch')
    expect(toolCardDescription('unknown-tool', '读取文件', false)).toBe('读取文件')
    expect(toolCardDescription('unknown-tool', '', false)).toBe('No description')
  })
})
