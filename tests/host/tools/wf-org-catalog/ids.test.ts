// tests/host/tools/wf-org-catalog/ids.test.ts
//
// 资产 id 解析与参数归一化单测（wf_org_catalog 的「传 ids / 不传 ids」判据）：
//   - 三类可召回形状（工作流资产 / 角色资产 / 工作流资产内联角色复合键）；
//   - 形状非法只返回原因，不抛错（由工具层翻译为单条 error）；
//   - 归一化：缺省 / 空数组 / 空串 / 空白项 / 重复项 / 非数组。

import { describe, expect, it } from 'vitest'
import { detailIdsLimitProblem, normalizeAssetIds, parseAssetId } from '../../../../src/host/tools/wf-org-catalog/ids.js'
import { CATALOG_LIMITS } from '../../../../src/host/tools/wf-org-catalog/types.js'

describe('parseAssetId（资产 id 形状判定）', () => {
  it('工作流资产 id：flow-* 前缀', () => {
    expect(parseAssetId('flow-1')).toEqual({ ok: true, kind: 'workflow', id: 'flow-1' })
  })

  it('角色资产 id：role-* 前缀', () => {
    expect(parseAssetId('role-1')).toEqual({ ok: true, kind: 'role', id: 'role-1' })
  })

  it('经验 id：不再是可召回形状（经验召回归 wf_experience_recall）', () => {
    const result = parseAssetId('ex-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('ex-1')
  })

  it('复合 id：切开容器与节点，并保留原 id', () => {
    expect(parseAssetId('flow-1#node-abc')).toEqual({
      ok: true,
      kind: 'inlineRole',
      id: 'flow-1#node-abc',
      containerId: 'flow-1',
      nodeId: 'node-abc',
    })
  })

  it('复合 id 两端空白被裁剪', () => {
    expect(parseAssetId('  flow-1 # node-abc  ')).toMatchObject({ ok: true, kind: 'inlineRole', containerId: 'flow-1', nodeId: 'node-abc' })
  })

  it('复合 id 缺一端 → 非法（提示正确形状）', () => {
    const result = parseAssetId('flow-1#')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('工作流资产 id')
  })

  it('复合 id 左侧不是工作流资产 id → 非法（内联角色只从工作流资产召回）', () => {
    const result = parseAssetId('role-1#node-abc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('内联角色只从工作流资产召回')
  })

  it('未知前缀（含旧模版前缀 tpl-）→ 非法（原因列出三种支持的形状）', () => {
    for (const raw of ['wf-1', 'tpl-1']) {
      const result = parseAssetId(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('flow-')
        expect(result.reason).toContain('role-')
        expect(result.reason).toContain('#')
        expect(result.reason).not.toContain('ex-')
      }
    }
  })

  it('空串 / 空白 / null → 非法', () => {
    expect(parseAssetId('').ok).toBe(false)
    expect(parseAssetId('   ').ok).toBe(false)
    expect(parseAssetId(null).ok).toBe(false)
  })
})

describe('normalizeAssetIds（参数归一化）', () => {
  it('缺省 / null / 空数组 / 空串 → 空列表（= 只看索引）', () => {
    expect(normalizeAssetIds(undefined)).toEqual([])
    expect(normalizeAssetIds(null)).toEqual([])
    expect(normalizeAssetIds([])).toEqual([])
    expect(normalizeAssetIds('')).toEqual([])
    expect(normalizeAssetIds('   ')).toEqual([])
  })

  it('过滤空白项并保持首次出现顺序去重', () => {
    expect(normalizeAssetIds([' flow-1 ', '', 'role-1', 'flow-1', 'flow-2', '  '])).toEqual(['flow-1', 'role-1', 'flow-2'])
  })

  it('非空单字符串不是合法形状（必须是数组）', () => {
    expect(normalizeAssetIds('flow-1')).toBeNull()
  })

  it('非数组类型 → null（调用方抛 WF_BAD_ARGS）', () => {
    expect(normalizeAssetIds(42)).toBeNull()
    expect(normalizeAssetIds({ id: 'flow-1' })).toBeNull()
  })
})

describe('detailIdsLimitProblem（单次召回上限）', () => {
  it('未超限 → null', () => {
    expect(detailIdsLimitProblem(CATALOG_LIMITS.detailIds)).toBeNull()
  })

  it('超限 → 给出可行动的提示（含上限与分批要求）', () => {
    const problem = detailIdsLimitProblem(CATALOG_LIMITS.detailIds + 1)
    expect(problem).toContain(String(CATALOG_LIMITS.detailIds))
    expect(problem).toContain('分批')
  })
})
