// tests/host/api/tool-descriptions.test.ts
//
// 组合管理卡片描述映射（api/tool-descriptions.ts）：中文短描述命中、
// 英文 [EN] 前缀与长度截断、空描述占位。

import { describe, expect, it } from 'vitest'
import { CARD_DESC_MAX, zhDescription } from '../../../src/host/api/tool-descriptions.js'

describe('组合管理卡片描述（zhDescription）', () => {
  const longEnglish = 'Apply one patch to a workflow template or the running instance. This tool has three op groups. '.repeat(8)

  it('自主编排两工具命中中文短描述（不再回退超长英文撑破卡片）', () => {
    expect(zhDescription('wf_graph_patch', longEnglish)).toBe('改写工作流图（图结构 / 元参数 / 里程碑标记，一次补丁仅一组）；仅父代理可用')
    expect(zhDescription('wf_org_catalog', longEnglish)).toContain('只读勘察组织资产')
    expect(zhDescription('wf_org_catalog', longEnglish).length).toBeLessThanOrEqual(CARD_DESC_MAX)
  })

  it('未命中：中文原文照用；英文加 [EN] 前缀并按 CARD_DESC_MAX 截断；空描述有占位', () => {
    expect(zhDescription('unknown-tool', '读取文件')).toBe('读取文件')
    const clipped = zhDescription('unknown-tool', longEnglish)
    expect(clipped.startsWith('[EN] ')).toBe(true)
    expect(clipped.length).toBe(CARD_DESC_MAX)
    expect(clipped.endsWith('…')).toBe(true)
    expect(zhDescription('unknown-tool', '')).toBe('（暂无描述）')
  })
})
