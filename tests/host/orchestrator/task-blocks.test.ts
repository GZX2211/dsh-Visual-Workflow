// tests/host/orchestrator/task-blocks.test.ts
//
// 节点任务块与节点契约测试（用户裁决 2026-10：契约不再有「注入 / 不注入」判据）：
//   - inputContractOf：data.inputSchema → 任务块中段「输入契约」，空串不组装该段；
//   - outputContractOf：data.outputSchema 逐字生效；空串即未配置（该段不出现）；
//     配置文本不与默认文本叠加；是否注入不再取决于 ctx 出线或是否存在下游；
//   - 默认文本由节点数据落盘（见 graph 工厂），解析只负责读取。
//
// 断言策略：不断言提示词具体措辞（属长期优化项），只断言「注入/不注入」与段位归属，
// 默认文本经共享常量 DEFAULT_OUTPUT_CONTRACT_TEXT 引用。
import { describe, expect, it } from 'vitest'
import { buildNodeBlocks, inputContractOf, outputContractOf } from '../../../src/host/orchestrator/index.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../src/host/shared/protocol.js'
import type { RoleNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import type { RunSnapshot } from '../../../src/host/shared/types.js'

/** 角色节点（可覆盖 inputSchema / outputSchema）。 */
function role(id: string, kind: 'parent' | 'agent' = 'agent', overrides: Record<string, unknown> = {}): RoleNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: {
      label: `节点${id}`,
      systemPrompt: `任务：${id}`,
      provider: '',
      model: '',
      presetId: 'combo-1',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
      ...overrides,
    },
  }
}

/** 流程：start → a1 → a2 → end（无下游的 a2 用于终端节点断言；可挂 ctx 线验证与契约无关）。 */
function makeFlow(options: { withCtx?: boolean; nodes?: RoleNode[] } = {}): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '交接流程',
    description: '',
    revision: 1,
    nodes: options.nodes ?? [role('a1'), role('a2')],
    lines: [
      ...(options.withCtx
        ? [{ id: 'c1', source: 'a1', target: 'a2', sourceHandle: 'ctx-out' as const, targetHandle: 'ctx-in' as const }]
        : []),
    ],
  }
}

const emptySnapshot: RunSnapshot = {
  id: 'run-1',
  flowId: 'flow-1',
  flowName: '交接流程',
  sessionId: 'session-1',
  mode: 'mode1',
  status: 'running',
  startedAt: new Date(0).toISOString(),
  endedAt: null,
  summary: '',
  nodes: [],
}

describe('节点契约解析（outputContractOf / inputContractOf）', () => {
  it('输出契约：配置文本逐字生效', () => {
    expect(outputContractOf(role('a1', 'agent', { outputSchema: '{结论, 置信度}' }))).toBe('{结论, 置信度}')
  })

  it('输出契约：空串即未配置（界面清空后该段不再注入）', () => {
    expect(outputContractOf(role('a1'))).toBe('')
    expect(outputContractOf(role('a1', 'agent', { outputSchema: '   ' }))).toBe('')
  })

  it('输出契约：配置文本不与默认文本叠加（用户改过就以改后为准）', () => {
    const text = outputContractOf(role('a1', 'agent', { outputSchema: '自定义契约字段' }))
    expect(text).toBe('自定义契约字段')
    expect(text).not.toContain(DEFAULT_OUTPUT_CONTRACT_TEXT)
  })

  it('输出契约：是否注入与 ctx 出线、是否存在下游无关（统一注入，可注入为空）', () => {
    const configured = role('a1', 'agent', { outputSchema: '自定义契约字段' })
    expect(outputContractOf(configured)).toBe('自定义契约字段')
    expect(outputContractOf(role('terminal', 'agent', { outputSchema: '终端契约' }))).toBe('终端契约')
  })

  it('inputContractOf：读取 data.inputSchema 并去空白；缺省为空串', () => {
    expect(inputContractOf(role('a1', 'agent', { inputSchema: '  上游纪要  ' }))).toBe('上游纪要')
    expect(inputContractOf(role('a1'))).toBe('')
  })

  it('纯函数：同输入两次解析结果相同', () => {
    const node = role('a1', 'agent', { outputSchema: 'A / B' })
    expect(outputContractOf(node)).toBe(outputContractOf(node))
  })
})

describe('buildNodeBlocks 契约注入（只断言数据，不断言文案）', () => {
  it('输入契约与输出契约都注入任务块，且输入契约在输出契约之前', () => {
    const flow = makeFlow({
      nodes: [role('a1', 'agent', { inputSchema: '上游交付的调研纪要', outputSchema: '结论 / 置信度' }), role('a2')],
    })
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).toContain('上游交付的调研纪要')
    expect(text).toContain('结论 / 置信度')
    expect(text.indexOf('上游交付的调研纪要')).toBeLessThan(text.indexOf('结论 / 置信度'))
  })

  it('未配置任何契约（界面清空）时不出现契约数据', () => {
    const flow = makeFlow({ nodes: [role('a1'), role('a2')] })
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).not.toContain('上游交付的调研纪要')
    expect(text).not.toContain('结论 / 置信度')
  })

  it('默认文本随节点数据落盘：未改动的节点按默认契约注入', () => {
    const flow = makeFlow({ nodes: [role('a1', 'agent', { outputSchema: DEFAULT_OUTPUT_CONTRACT_TEXT }), role('a2')] })
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).toContain(DEFAULT_OUTPUT_CONTRACT_TEXT)
  })

  it('终端节点（无下游）同样注入输出契约', () => {
    const flow = makeFlow({ nodes: [role('a1'), role('terminal', 'agent', { outputSchema: '终端契约字段' })] })
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[1] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).toContain('终端契约字段')
  })
})

describe('Team 成员任务块（协作通道差异）', () => {
  /** Team 流程：成员 m1（groupId）包在 Team 卡片 g1 内，卡片带用户填写的协作说明。 */
  function teamFlow(): WorkflowDocument {
    const member = role('m1', 'agent', { groupId: 'g1' })
    return {
      id: 'flow-team',
      sessionId: 'session-1',
      mode: 'mode1',
      name: 'Team 流程',
      description: '',
      revision: 1,
      nodes: [
        member,
        {
          id: 'g1',
          kind: 'group',
          position: { x: 0, y: 0 },
          data: { label: '评审组', collabPrompt: '成员互相质询', memberIds: ['m1'], size: { w: 300, h: 220 } },
        },
      ],
      lines: [],
    }
  }

  function memberBlock(channel: 'official' | 'legacy'): string {
    const flow = teamFlow()
    return buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
      collabChannel: channel,
    })[0].text
  }

  it('official 通道：不注入成员清单与通信指引（官方 team:policy 承担），仅注入用户填写的团队协作说明', () => {
    const text = memberBlock('official')
    expect(text).toContain('成员互相质询')
    expect(text).not.toContain('本组成员为')
    expect(text).not.toContain('wf_ask_agent')
  })

  it('legacy 通道：注入成员清单与 wf_ask_agent 通信指引（成员已降级为普通子代理）', () => {
    const text = memberBlock('legacy')
    expect(text).toContain('本组成员为')
    expect(text).toContain('wf_ask_agent')
    expect(text).toContain('成员互相质询')
  })
})
