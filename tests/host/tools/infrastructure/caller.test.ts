// tests/host/tools/infrastructure/caller.test.ts
//
// 调用方身份派生（callerOf）单测：根 Agent 与子代理判定、sessionId 取值、
// 旧字段组合兼容、无 agent 的兜底。

import { describe, expect, it } from 'vitest'
import { callerOf } from '../../../../src/host/tools/infrastructure/caller.js'
import { childAgent, execOf, rootAgent } from '../fixtures/tool-harness.js'

describe('callerOf 身份派生', () => {
  it('根 Agent：isChild=false，sessionId 取 agent.id', () => {
    const caller = callerOf(execOf(rootAgent))
    expect(caller).toEqual({ isChild: false, sessionId: 'session-1' })
  })

  it('根 Agent 无 session：仍判为根，sessionId 取 agent.id', () => {
    const caller = callerOf(execOf({ id: 'session-9' }))
    expect(caller).toEqual({ isChild: false, sessionId: 'session-9' })
  })

  it('子代理：isChild=true，sessionId 取 header.parentSession（父会话）', () => {
    const caller = callerOf(execOf(childAgent))
    expect(caller).toEqual({ isChild: true, sessionId: 'session-1' })
  })

  it('parentSession 存在但 origin 缺失也判为子代理（兼容旧字段组合）', () => {
    const caller = callerOf(execOf({ id: 'child-2', session: { header: { parentSession: 'session-1' } } }))
    expect(caller.isChild).toBe(true)
    expect(caller.sessionId).toBe('session-1')
  })

  it('无 agent：isChild=false、sessionId 为空（调用方错误由编排器拒绝）', () => {
    const caller = callerOf(execOf(null))
    expect(caller).toEqual({ isChild: false, sessionId: '' })
  })
})
