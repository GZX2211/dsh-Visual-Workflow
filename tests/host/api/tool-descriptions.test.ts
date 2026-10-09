// tests/host/api/tool-descriptions.test.ts
//
// 组合管理卡片描述映射（api/tool-descriptions.ts）：中文短描述命中、
// 英文 [EN] 前缀与长度截断、空描述占位。

import { describe, expect, it } from 'vitest'
import { CARD_DESC_MAX, zhDescription } from '../../../src/host/api/tool-descriptions.js'
import {
  WF_EXPERIENCE_FEEDBACK,
  WF_EXPERIENCE_LEARN,
  WF_EXPERIENCE_RECALL,
} from '../../../src/host/shared/protocol.js'

describe('组合管理卡片描述（zhDescription）', () => {
  const longEnglish = 'Apply one patch to a workflow template or the running instance. This tool has three op groups. '.repeat(8)

  it('自主编排两工具命中中文短描述（不再回退超长英文撑破卡片）', () => {
    expect(zhDescription('wf_graph_patch', longEnglish)).toBe('改写工作流图（图结构 / 里程碑标记，一次补丁仅一组）；仅父代理可用')
    expect(zhDescription('wf_org_catalog', longEnglish)).toContain('只读勘察组织资产')
    expect(zhDescription('wf_org_catalog', longEnglish).length).toBeLessThanOrEqual(CARD_DESC_MAX)
  })

  it('经验三工具均命中中文短描述（新工具不得回退成截断的英文卡片）', () => {
    for (const name of [WF_EXPERIENCE_LEARN, WF_EXPERIENCE_RECALL, WF_EXPERIENCE_FEEDBACK]) {
      const text = zhDescription(name, longEnglish)
      expect(text.startsWith('[EN] ')).toBe(false)
      expect(text.length).toBeLessThanOrEqual(CARD_DESC_MAX)
    }
    expect(zhDescription(WF_EXPERIENCE_FEEDBACK, longEnglish)).toContain('评价')
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
