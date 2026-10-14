// tests/host/team/member-name.test.ts
//
// Team 成员名派生单测：
//   - 官方名字约束（小写短横线、长度上限、保留名 lead）在本地前置校验与派生结果上成立；
//   - 派生确定性：同一节点 id 恒得同名（官方名字在同一团队内永久不可复用，复用判定依赖它）；
//   - 大小写不同 / 非常规字符 / 超长的 id 走散列分支，互不碰撞。

import { describe, expect, it } from 'vitest'
import {
  isTeammateNameValid,
  teammateDescriptionOf,
  teammateNameOf,
  TEAM_MEMBER_DESCRIPTION_MAX_LENGTH,
  TEAM_MEMBER_NAME_MAX_LENGTH,
} from '../../../src/host/team/member-name.js'

describe('teammateNameOf / isTeammateNameValid', () => {
  it('常规节点 id：加前缀直用，满足官方名字约束', () => {
    const name = teammateNameOf('n-be-dev')
    expect(name).toBe('m-n-be-dev')
    expect(isTeammateNameValid(name)).toBe(true)
  })

  it('确定性：同一 id 多次派生结果相同；不同 id 结果不同', () => {
    expect(teammateNameOf('n-req')).toBe(teammateNameOf('n-req'))
    expect(teammateNameOf('n-req')).not.toBe(teammateNameOf('n-arch'))
  })

  it('派生结果永不等于保留名 lead', () => {
    expect(teammateNameOf('lead')).not.toBe('lead')
    expect(teammateNameOf('lead').startsWith('m-')).toBe(true)
  })

  it('大写 / 空格 / 中文 / 空串 id：走散列分支，仍为合法名字且互不碰撞', () => {
    const samples = ['Node-A', 'node a', '需求规格化', '', 'node-']
    const names = samples.map((id) => teammateNameOf(id))
    for (const name of names) {
      expect(isTeammateNameValid(name)).toBe(true)
      expect(name.startsWith('m-')).toBe(true)
    }
    expect(new Set(names).size).toBe(names.length)
  })

  it('大小写不同视为不同成员（不做小写折叠，避免两节点映射到同一名字）', () => {
    expect(teammateNameOf('Node-A')).not.toBe(teammateNameOf('node-a'))
  })

  it('超长 id：散列后不超过官方长度上限', () => {
    const name = teammateNameOf(`n-${'x'.repeat(120)}`)
    expect(name.length).toBeLessThanOrEqual(TEAM_MEMBER_NAME_MAX_LENGTH)
    expect(isTeammateNameValid(name)).toBe(true)
  })
})

describe('isTeammateNameValid', () => {
  it('拒绝保留名、空串、连续短横线、下划线、超长名字', () => {
    expect(isTeammateNameValid('lead')).toBe(false)
    expect(isTeammateNameValid('')).toBe(false)
    expect(isTeammateNameValid('a--b')).toBe(false)
    expect(isTeammateNameValid('a_b')).toBe(false)
    expect(isTeammateNameValid('A-b')).toBe(false)
    expect(isTeammateNameValid('x'.repeat(TEAM_MEMBER_NAME_MAX_LENGTH + 1))).toBe(false)
  })
})

describe('teammateDescriptionOf', () => {
  it('取角色名；缺失时回退节点 id；超长按官方上限截断', () => {
    expect(teammateDescriptionOf('需求规格化', 'n-req')).toBe('需求规格化')
    expect(teammateDescriptionOf('', 'n-req')).toBe('n-req')
    expect(teammateDescriptionOf('', '')).toBe('teammate')
    expect(teammateDescriptionOf('角'.repeat(300), 'n-req')).toHaveLength(TEAM_MEMBER_DESCRIPTION_MAX_LENGTH)
  })
})
