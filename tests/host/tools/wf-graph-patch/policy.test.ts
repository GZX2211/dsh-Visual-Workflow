// tests/host/tools/wf-graph-patch/policy.test.ts
//
// 角色节点模型选择取值策略（纯函数）单测：
//   - knownModelsOf：清单结构守卫（非法行跳过、空清单/null、档位两种来源）；
//   - writtenModelSelectionsOf：只收集本批显式写入项（含应用后的有效 provider/model）；
//   - modelSelectionFailures：provider 未知 / provider 与 model 写反 / model 不属于该 provider /
//     provider 为空时按全清单判定 / reasoning 档位判定与「未公布档位不判定」的兼容性。
// 清单数据取自实机（GUI models 端点）形状，其中 ling-3.0 确实**不公布**思考强度档位。

import { describe, expect, it } from 'vitest'
import {
  knownModelsOf,
  modelSelectionFailures,
  writtenModelSelectionsOf,
  type ModelCatalogEntry,
  type WrittenModelSelection,
} from '../../../../src/host/tools/wf-graph-patch/policy.js'
import type { GraphNode } from '../../../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 清单 fixture（实机 GUI models 端点的宿主投影形状：efforts 为 { id, name }）
// ---------------------------------------------------------------------------

const LING_MODEL = 'inclusionai/ling-3.0-flash-sante:free'

/** 实机清单：负责 provider 与 model 的配对；ling-3.0 未公布思考强度档位。 */
const LIVE_ROWS: unknown[] = [
  { provider: 'opencode-go', model: 'deepseek-v4-flash-vision-exp' },
  { provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' },
  { provider: 'commandcode', model: LING_MODEL },
  { provider: 'deepseek-official', model: 'deepseek-flash', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
]

function catalogOf(rows: unknown[] = LIVE_ROWS): ModelCatalogEntry[] {
  const known = knownModelsOf(rows)
  if (!known) throw new Error('fixture 清单不可用')
  return known
}

/** 造一个角色节点（只声明本用例关心的字段）。 */
function roleNode(id: string, data: Record<string, unknown> = {}, kind: 'agent' | 'parent' = 'agent'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: id, systemPrompt: '', provider: '', model: '', retryLimit: 3, ...data } } as GraphNode
}

/** 造一条「本批显式写入」记录（默认有效值与写入值一致）。 */
function written(overrides: Partial<WrittenModelSelection> = {}): WrittenModelSelection {
  return {
    index: 0,
    op: 'update_node_data',
    nodeId: 'a1',
    effectiveProvider: '',
    effectiveModel: '',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 清单结构守卫
// ---------------------------------------------------------------------------

describe('knownModelsOf · 模型清单结构守卫', () => {
  it('宿主投影形状逐行收下，档位取 id、无档位的模型不带 efforts 键', () => {
    const known = catalogOf()
    expect(known).toHaveLength(5)
    expect(known.find((entry) => entry.model === 'deepseek-flash')?.efforts).toEqual(['off', 'high'])
    expect(known.find((entry) => entry.model === LING_MODEL)?.efforts).toBeUndefined()
  })

  it('适配器原样给出的字符串档位同样收下；空档位数组视为未公布', () => {
    const known = catalogOf([
      { provider: 'p1', model: 'm1', efforts: ['low', 'high'] },
      { provider: 'p2', model: 'm2', efforts: [] },
    ])
    expect(known[0].efforts).toEqual(['low', 'high'])
    expect(known[1].efforts).toBeUndefined()
  })

  it('非法行（缺 provider/model、非对象）跳过；全空清单返回 null（放弃判定）', () => {
    expect(knownModelsOf([null, 'x', 3, { provider: 'p1' }, { model: 'm1' }, { provider: '  ', model: 'm1' }])).toBeNull()
    expect(knownModelsOf([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 本批写入项提取
// ---------------------------------------------------------------------------

describe('writtenModelSelectionsOf · 只收集本批显式写入项', () => {
  it('create_node：写入非空值进入判定，空串/null 视为未写入', () => {
    const ops = [
      { op: 'create_node' as const, node: { id: 'n1', kind: 'agent', data: { provider: 'commandcode', model: LING_MODEL } } },
      { op: 'create_node' as const, node: { id: 'n2', kind: 'agent', data: { provider: '', model: null, reasoning: undefined } } },
    ]
    const writtenItems = writtenModelSelectionsOf(ops, { nodes: [] })
    expect(writtenItems).toHaveLength(1)
    expect(writtenItems[0]).toMatchObject({
      index: 0, op: 'create_node', nodeId: 'n1', provider: 'commandcode', model: LING_MODEL,
      effectiveProvider: 'commandcode', effectiveModel: LING_MODEL,
    })
  })

  it('create_node 未显式给 id：nodeId 用占位文案（不伪造 id）', () => {
    const ops = [{ op: 'create_node' as const, node: { kind: 'agent', data: { model: LING_MODEL } } }]
    expect(writtenModelSelectionsOf(ops, { nodes: [] })[0].nodeId).toBe('(待生成 id)')
  })

  it('update_node_data：有效 provider/model 取应用后的文档（未写入的字段继承现值）', () => {
    const applied = { nodes: [roleNode('a1', { provider: 'commandcode', model: LING_MODEL, reasoning: 'high' })] }
    const items = writtenModelSelectionsOf([{ op: 'update_node_data' as const, nodeId: 'a1', data: { reasoning: 'low' } }], applied)
    expect(items).toHaveLength(1)
    expect(items[0].reasoning).toBe('low')
    expect(items[0].provider).toBeUndefined()
    expect(items[0].effectiveProvider).toBe('commandcode')
    expect(items[0].effectiveModel).toBe(LING_MODEL)
  })

  it('非角色节点（文件 / 阶段 / 虚拟节点）不进入模型选择判定', () => {
    const createOps = [
      { op: 'create_node' as const, node: { id: 'f1', kind: 'file', data: { provider: 'p', model: 'm' } } },
      { op: 'remove_node' as const, nodeId: 'a1' },
    ]
    expect(writtenModelSelectionsOf(createOps, { nodes: [] })).toEqual([])
    const applied = { nodes: [{ id: 'f1', kind: 'file', position: { x: 0, y: 0 }, data: { provider: 'p', model: 'm' } } as unknown as GraphNode] }
    expect(writtenModelSelectionsOf([{ op: 'update_node_data' as const, nodeId: 'f1', data: { model: 'm' } }], applied)).toEqual([])
  })

  it('节点上只有历史脏值、本批未写这三个字段：不产生写入项（历史值不阻断别的补丁）', () => {
    const applied = { nodes: [roleNode('a1', { provider: 'inclusionai', model: 'ling-3.0-flash-sante:free' })] }
    expect(writtenModelSelectionsOf([{ op: 'update_node_data' as const, nodeId: 'a1', data: { label: '新标签' } }], applied)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 存在性判定
// ---------------------------------------------------------------------------

describe('modelSelectionFailures · provider/model 存在性', () => {
  it('实机复现：把 model 的「组织/」前缀当成 provider → 两条失败并给出正确配对', () => {
    const failures = modelSelectionFailures(catalogOf(), [written({
      provider: 'inclusionai',
      model: 'ling-3.0-flash-sante:free',
      effectiveProvider: 'inclusionai',
      effectiveModel: 'ling-3.0-flash-sante:free',
    })])
    expect(failures).toHaveLength(2)
    expect(failures.every((item) => item.code === 'WF_BAD_ARGS')).toBe(true)
    expect(failures[0].message).toContain('provider「inclusionai」不在模型清单中')
    expect(failures[0].message).toContain(`应写 provider="commandcode"、model="${LING_MODEL}"`)
    expect(failures[0].message).toContain('可用配对')
    expect(failures[1].message).toContain('model「ling-3.0-flash-sante:free」不在模型清单中')
  })

  it('合法配对通过（model 里的「组织/」前缀原样保留）', () => {
    expect(modelSelectionFailures(catalogOf(), [written({
      provider: 'commandcode', model: LING_MODEL, effectiveProvider: 'commandcode', effectiveModel: LING_MODEL,
    })])).toEqual([])
  })

  it('provider 合法但 model 不属于该 provider → 拒绝并列出该 provider 的可用模型', () => {
    const failures = modelSelectionFailures(catalogOf(), [written({
      provider: 'commandcode', model: 'deepseek-flash', effectiveProvider: 'commandcode', effectiveModel: 'deepseek-flash',
    })])
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('不在 provider「commandcode」的模型清单中')
    expect(failures[0].message).toContain('该 model 属于 provider「deepseek-official」')
    expect(failures[0].message).toContain('deepseek/deepseek-v4.1-flash')
  })

  it('只写 model 而节点现值 provider 已知 → 按该 provider 判定', () => {
    const failures = modelSelectionFailures(catalogOf(), [written({
      model: 'deepseek-flash', effectiveProvider: 'commandcode', effectiveModel: 'deepseek-flash',
    })])
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('provider「commandcode」')
  })

  it('只写 provider 而节点现值 model 与之不匹配 → 拒绝（补丁后的配对必须可用）', () => {
    const failures = modelSelectionFailures(catalogOf(), [written({
      provider: 'deepseek-official', effectiveProvider: 'commandcode', effectiveModel: LING_MODEL,
    })])
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain(`model「${LING_MODEL}」`)
  })

  it('provider 为空（未写入）且 model 未知 → 按全清单判定并拒绝', () => {
    const failures = modelSelectionFailures(catalogOf(), [written({
      model: 'not-a-model', effectiveModel: 'not-a-model',
    })])
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('未写入 provider，按节点现值与全清单判定')
  })
})

describe('modelSelectionFailures · reasoning 档位', () => {
  it('模型公布了档位：档位外的值被拒、档位内的值通过', () => {
    const base = { provider: 'deepseek-official', model: 'deepseek-flash', effectiveProvider: 'deepseek-official', effectiveModel: 'deepseek-flash' }
    const bad = modelSelectionFailures(catalogOf(), [written({ ...base, reasoning: 'medium' })])
    expect(bad).toHaveLength(1)
    expect(bad[0].message).toContain('reasoning「medium」')
    expect(bad[0].message).toContain('可用：off/high')
    expect(modelSelectionFailures(catalogOf(), [written({ ...base, reasoning: 'high' })])).toEqual([])
  })

  it('模型未公布档位（实机 ling-3.0）：写入任意档位不判定（保留默认档位的兼容性）', () => {
    const base = { provider: 'commandcode', model: LING_MODEL, effectiveProvider: 'commandcode', effectiveModel: LING_MODEL }
    expect(modelSelectionFailures(catalogOf(), [written({ ...base, reasoning: 'medium' })])).toEqual([])
  })

  it('配对未知（清单里没有该 provider/model）：档位无法判定，只报取值本身的两条错误', () => {
    const failures = modelSelectionFailures(catalogOf(), [written({
      provider: 'other-provider', model: 'other-model', effectiveProvider: 'other-provider', effectiveModel: 'other-model', reasoning: 'medium',
    })])
    expect(failures).toHaveLength(2)
    expect(failures.every((item) => item.message.includes('reasoning'))).toBe(false)
  })
})
