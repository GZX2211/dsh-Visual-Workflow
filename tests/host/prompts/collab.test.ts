// tests/host/prompts/collab.test.ts
//
// T-005 协作成员清单块模板基线：始终含成员 ID+角色名，自定义说明追加式。

import { describe, expect, it } from 'vitest'
import { buildCollabBlock } from '../../../src/host/prompts/index.js'

describe('T-005 协作成员清单块模板（始终含成员 ID+角色名 + 自定义说明）', () => {
  const members = [
    { id: 'node-a', label: '分析节点' },
    { id: 'node-b', label: '总结节点' },
  ]

  it('无论 custom 是否为空，都默认列出组内全部成员的 ID 与角色名', () => {
    const block = buildCollabBlock({ members, custom: '' })
    for (const member of members) {
      expect(block).toContain(member.label)
      expect(block).toContain(member.id)
    }
  })

  it('custom 非空时追加到成员清单之后（追加式结构，以成员 id 为锚定位）', () => {
    const block = buildCollabBlock({ members, custom: '成员 A 与 B 互相质询' })
    expect(block).toContain('成员 A 与 B 互相质询')
    expect(block.indexOf(members[1].id)).toBeLessThan(block.indexOf('成员 A 与 B 互相质询'))
  })

  it('同一 params 两次构建字节相同', () => {
    expect(buildCollabBlock({ members, custom: '并行通信' })).toBe(buildCollabBlock({ members, custom: '并行通信' }))
  })
})
