// tests/host/config.test.ts
//
// 配置解析单测（resolveConfig）：默认值填充与「待回复登记 TTL」旧键名的读取兼容。
// 兼容契约：旧键 wfAskAgentTimeoutMs 仅在 >0 时投影到新键 wfAskAgentTtlMs，新键优先。
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/host/config.js'

describe('resolveConfig：wf_ask_agent TTL 键名迁移', () => {
  it('缺省：新键取默认 120000', () => {
    expect(resolveConfig({}).wfAskAgentTtlMs).toBe(120000)
  })

  it('新键生效', () => {
    expect(resolveConfig({ wfAskAgentTtlMs: 5000 }).wfAskAgentTtlMs).toBe(5000)
  })

  it('旧键（>0）读取兼容：投影到新键', () => {
    expect(resolveConfig({ wfAskAgentTimeoutMs: 7000 }).wfAskAgentTtlMs).toBe(7000)
  })

  it('两键同时给出：新键优先', () => {
    expect(resolveConfig({ wfAskAgentTtlMs: 5000, wfAskAgentTimeoutMs: 7000 }).wfAskAgentTtlMs).toBe(5000)
  })

  it('旧键为 0（未设置）不覆盖默认值', () => {
    expect(resolveConfig({ wfAskAgentTimeoutMs: 0 }).wfAskAgentTtlMs).toBe(120000)
  })
})
