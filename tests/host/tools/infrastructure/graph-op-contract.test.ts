// tests/host/tools/infrastructure/graph-op-contract.test.ts
//
// 写图契约的完整性与单一来源守卫：
//   - 每个 op 名都有字段形状（新增 op 忘了补契约会在此失败）；
//   - 契约全文覆盖提交规则 / op 形状 / 角色 data 契约 / 错误码语义；
//   - 契约指引点名 catalog rules 的两个键（键名漂移会在此失败）。

import { describe, expect, it } from 'vitest'
import {
  ERROR_CODE_SEMANTICS,
  GATE_MARKING_SEMANTICS,
  GRAPH_OP_FIELD_TEXT,
  MARK_OP_FIELD_TEXT,
  OP_FIELD_SHAPES,
  PATCH_CONTRACT_POINTER,
  PATCH_CONTRACT_TEXT,
  PATCH_SUBMISSION_RULES,
  ROLE_NODE_DATA_CONTRACT,
} from '../../../../src/host/tools/infrastructure/graph-op-contract.js'
import { GRAPH_OP_NAMES, MARK_OP_NAMES, opGroupOf } from '../../../../src/host/tools/wf-graph-patch/types.js'

describe('写图契约（graph-op-contract）', () => {
  it('op 名清单与字段形状一一对应（新增图结构 op 必须同步补形状）', () => {
    expect(Object.keys(OP_FIELD_SHAPES).sort()).toEqual([...GRAPH_OP_NAMES].sort())
    for (const name of [...GRAPH_OP_NAMES, ...MARK_OP_NAMES]) {
      expect(opGroupOf({ op: name })).not.toBeNull()
      expect(GRAPH_OP_FIELD_TEXT.includes(name) || MARK_OP_FIELD_TEXT.includes(name)).toBe(true)
    }
  })

  it('契约全文由四段同源文本组成', () => {
    expect(PATCH_CONTRACT_TEXT).toContain(PATCH_SUBMISSION_RULES)
    expect(PATCH_CONTRACT_TEXT).toContain(GRAPH_OP_FIELD_TEXT)
    expect(PATCH_CONTRACT_TEXT).toContain(ROLE_NODE_DATA_CONTRACT)
    expect(PATCH_CONTRACT_TEXT).toContain(ERROR_CODE_SEMANTICS)
  })

  it('提交规则写明整批原子、一组一次与坐标不填', () => {
    expect(PATCH_SUBMISSION_RULES).toContain('只能含一组 op')
    expect(PATCH_SUBMISSION_RULES).toContain('整批不落盘')
    expect(PATCH_SUBMISSION_RULES).toContain('不接受节点坐标')
  })

  it('角色 data 契约写明 presetId 为空等于零工具，且画布字段不可配置', () => {
    expect(ROLE_NODE_DATA_CONTRACT).toContain('presetId')
    expect(ROLE_NODE_DATA_CONTRACT).toContain('没有任何工具')
    expect(ROLE_NODE_DATA_CONTRACT).toContain('injectToolSections')
  })

  it('角色 data 契约写明 provider/model 必须成对取值（model 里的「组织/」前缀属 model 本身）', () => {
    expect(ROLE_NODE_DATA_CONTRACT).toContain('成对复制模型清单的两列')
    expect(ROLE_NODE_DATA_CONTRACT).toContain('不是 provider')
    expect(ROLE_NODE_DATA_CONTRACT).toContain('会被补丁拒绝')
  })

  it('闸门标记语义独立成段并写明只对当前闸门有效', () => {
    expect(GATE_MARKING_SEMANTICS).toContain('mark_node')
    expect(GATE_MARKING_SEMANTICS).toContain('milestone')
    expect(GATE_MARKING_SEMANTICS).toContain('1 条')
  })

  it('契约指引点名 catalog rules 的两个键（键名漂移会在此失败）', () => {
    expect(PATCH_CONTRACT_POINTER).toContain('rules.patchContract')
    expect(PATCH_CONTRACT_POINTER).toContain('rules.gateMarking')
  })
})
