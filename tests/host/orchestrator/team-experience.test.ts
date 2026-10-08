// tests/host/orchestrator/team-experience.test.ts
//
// 协作组「Team 经验召回查询」的纯函数单测：查询由组任务上下文与成员任务稳定组装，
// 同一入参字节相同，内容或顺序变化即产生不同查询（供召回去重与缓存使用）。

import { describe, expect, it } from 'vitest'
import {
  TEAM_EXPERIENCE_CAUTION_FIELD,
  TEAM_EXPERIENCE_MEMBERS_FIELD,
  TEAM_EXPERIENCE_QUERY_MARKER,
  TEAM_EXPERIENCE_QUERY_NONE,
  buildTeamExperienceQuery,
  type TeamExperienceQueryInput,
} from '../../../src/host/orchestrator/index.js'

/** 基础查询入参（用例只覆盖关心字段）。 */
function input(overrides: Partial<TeamExperienceQueryInput> = {}): TeamExperienceQueryInput {
  return {
    sessionId: 'session-1',
    flowId: 'flow-g',
    groupId: 'n-g1',
    groupLabel: '后端开发组',
    collabPrompt: '组内并行',
    members: [
      { label: '后端开发工程师', task: '实现接口' },
      { label: '后端代码审查专家', task: '审查实现' },
    ],
    ...overrides,
  }
}

describe('buildTeamExperienceQuery（组任务上下文摘要纯函数）', () => {
  it('确定性：同一入参两次调用字节相同', () => {
    expect(buildTeamExperienceQuery(input())).toBe(buildTeamExperienceQuery(input()))
  })

  it('组任务与成员文本进入查询：组名、协作 Prompt、成员角色名与成员任务可见', () => {
    const query = buildTeamExperienceQuery(input())
    expect(query).toContain(TEAM_EXPERIENCE_QUERY_MARKER)
    expect(query).toContain('后端开发组')
    expect(query).toContain('组内并行')
    expect(query).toContain('后端开发工程师')
    expect(query).toContain('实现接口')
    expect(query).toContain('后端代码审查专家')
    expect(query).toContain('审查实现')
  })

  it('含字段锚点：成员清单段与警示段齐备（供召回侧识读与测试断言）', () => {
    const query = buildTeamExperienceQuery(input())
    expect(query).toContain(TEAM_EXPERIENCE_MEMBERS_FIELD)
    expect(query).toContain(TEAM_EXPERIENCE_CAUTION_FIELD)
  })

  it('成员按给定顺序逐条列出：顺序即语义，不重排', () => {
    const first = buildTeamExperienceQuery(input({ members: [{ label: 'A', task: 'a' }, { label: 'B', task: 'b' }] }))
    const second = buildTeamExperienceQuery(input({ members: [{ label: 'B', task: 'b' }, { label: 'A', task: 'a' }] }))
    expect(first).not.toBe(second)
  })

  it('空白折叠：仅缩进/换行差异的成员文本产生同一查询', () => {
    const spaced = buildTeamExperienceQuery(input({ members: [{ label: '  后端开发工程师  ', task: '实现\n\t接口  ' }] }))
    const compact = buildTeamExperienceQuery(input({ members: [{ label: '后端开发工程师', task: '实现 接口' }] }))
    expect(spaced).toBe(compact)
  })

  it('成员任务超长截断：稳定上限，不因长任务无限增长', () => {
    const long = buildTeamExperienceQuery(input({ members: [{ label: 'A', task: 'x'.repeat(5000) }] }))
    const short = buildTeamExperienceQuery(input({ members: [{ label: 'A', task: 'x'.repeat(400) }] }))
    expect(long).toBe(short)
    expect(long.length).toBeLessThan(2000)
  })

  it('空成员：不崩溃且给出稳定「无成员」标记', () => {
    const query = buildTeamExperienceQuery(input({ members: [] }))
    expect(query).toContain(TEAM_EXPERIENCE_QUERY_NONE)
    expect(query).toBe(buildTeamExperienceQuery(input({ members: [] })))
  })

  it('内容变化：组名/协作 Prompt/成员任务任一变化都产生不同查询', () => {
    const base = buildTeamExperienceQuery(input())
    expect(buildTeamExperienceQuery(input({ groupLabel: '前端开发组' }))).not.toBe(base)
    expect(buildTeamExperienceQuery(input({ collabPrompt: '串行交接' }))).not.toBe(base)
    expect(buildTeamExperienceQuery(input({ members: [{ label: '后端开发工程师', task: '改为实现前端' }] }))).not.toBe(base)
    expect(buildTeamExperienceQuery(input({ groupId: 'n-g2' }))).not.toBe(base)
  })
})
