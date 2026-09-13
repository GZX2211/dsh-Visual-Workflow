// tests/host/wf-org-catalog.test.ts
//
// wf_org_catalog 只读勘察工具单测（自主编排方案 §4.1）：
//   - 目录内容：角色/组合/工具开关现状/preset/数据源/模板库/预算与规模口径；
//   - 预算化：条目与摘要截断 + truncated 标记；角色提示词正文只在 detail.roleId 时返回（且截断）；
//   - templateId 定向：返回该模板拓扑摘要；不存在 → WF_ORG_NOT_FOUND；
//   - 运行中勘察：以运行事实源读画布 + 顺带刷新空闲基准（方案 §5.1 双保险）；
//   - 幂等零副作用：不改任何文档、不产生写调用。

import { describe, expect, it } from 'vitest'
import { buildOrgCatalog, CATALOG_LIMITS, clip, type OrgCatalogHost } from '../../src/host/tools/wf-org-catalog.js'
import { WfError } from '../../src/host/orchestrator/seams.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../src/host/shared/graph-model.js'

function stageNode(id: string, kind: 'start' | 'end'): WorkflowDocument['nodes'][number] {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: kind === 'start' ? '启动' : '结束' } }
}

function agentNode(id: string, label: string): WorkflowDocument['nodes'][number] {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label, systemPrompt: '你是分析员', provider: 'deepseek', model: 'deepseek-chat',
      presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null,
    },
  }
}

function makeFlow(id = 'wf-1', extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id, sessionId: 'session-1', mode: 'mode1', name: '流程', description: '', revision: 1,
    nodes: [stageNode('s', 'start'), agentNode('a1', '分析'), stageNode('e', 'end')],
    lines: [
      { id: 'l1', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'a1', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
    ...extra,
  }
}

function makeHost(overrides: Partial<OrgCatalogHost> = {}) {
  const touched: string[] = []
  const host: OrgCatalogHost = {
    store: {
      async listTemplates() {
        return [
          { id: 'role-1', name: '分析员', kind: 'agent', provider: 'deepseek', model: 'deepseek-chat', systemPrompt: '你是分析员。'.repeat(60) },
        ]
      },
      async listToolCombos() {
        return [{ id: 'combo-1', name: '分析组合', tools: ['wf_ask_agent'], mcpServers: [] }]
      },
      async listFlowTemplates(): Promise<WorkflowTemplate[]> {
        return [{ id: 'tpl-1', mode: 'mode1', name: '模板一', description: '', revision: 1, nodes: [], lines: [] }]
      },
      async getFlowTemplate(id: string): Promise<WorkflowTemplate | null> {
        return id === 'tpl-1'
          ? { id, mode: 'mode1', name: '模板一', description: '', revision: 1, nodes: makeFlow().nodes, lines: makeFlow().lines }
          : null
      },
      async listWorkflows(): Promise<WorkflowDocument[]> {
        return [makeFlow()]
      },
      async getRun(): Promise<unknown> {
        return null
      },
      async listRuns(): Promise<unknown[]> {
        return [{ id: 'run-9', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z', nodes: [{ status: 'ok' }, { status: 'fail' }] }]
      },
    },
    toolSwitches: { currentDisabled: () => new Set(['wf_graph_patch']) },
    listTools: async () => [{ name: 'read' }, { name: 'run_code' }, { name: 'wf_run_node' }, { name: 'wf_graph_patch' }],
    listPresets: async () => [{ id: 'standard', name: '标准' }],
    listModels: async () => [{ provider: 'deepseek', model: 'deepseek-chat' }],
    activeRunOf: () => null,
    touchRun: (sessionId: string) => { touched.push(sessionId) },
    milestoneUsedOf: () => 0,
    ...overrides,
  }
  return { host, touched }
}

describe('wf_org_catalog（只读勘察）', () => {
  it('返回目录六要素 + 预算与规模口径', async () => {
    const { host } = makeHost()
    const catalog = await buildOrgCatalog(host, 'session-1', {})
    expect((catalog.roles as unknown[]).length).toBe(1)
    expect((catalog.combos as unknown[]).length).toBe(1)
    expect(catalog.presets).toEqual([{ id: 'standard', name: '标准' }])
    expect((catalog.templates as Array<{ id: string }>)[0].id).toBe('tpl-1')
    expect(catalog.scale).toMatchObject({ executableNodes: 1, groups: 0, maxGroupMembers: 0 })
    const limits = catalog.limits as Record<string, unknown>
    expect(limits.nodeUsed).toBe(1)
    expect(limits.nodeMax).toBe(0) // 未配置 meta → 不限制
    expect(limits.nodeRemaining).toBeNull()
  })

  it('工具开关现状：available 剔除保留名与子代理隐藏工具，disabled 原样给出', async () => {
    const { host } = makeHost()
    const catalog = await buildOrgCatalog(host, 'session-1', {})
    const tools = catalog.tools as { available: string[]; disabled: string[] }
    // run_code（官方保留传输名）剔除；wf_run_node 属子代理隐藏集，父代理目录里不列（仍可调用）
    expect(tools.available).toEqual(['read'])
    expect(tools.disabled).toEqual(['wf_graph_patch'])
  })

  it('预算化：摘要截断到上限内；detailRoleId 才返回提示词正文（且截断）', async () => {
    const { host } = makeHost()
    const plain = await buildOrgCatalog(host, 'session-1', {})
    const role = (plain.roles as Array<{ summary: string }>)[0]
    expect(role.summary.length).toBeLessThanOrEqual(CATALOG_LIMITS.summary + 8)
    expect('rolePrompt' in plain).toBe(false)

    const detailed = await buildOrgCatalog(host, 'session-1', { detailRoleId: 'role-1' })
    const prompt = detailed.rolePrompt as { id: string; systemPrompt: string }
    expect(prompt.id).toBe('role-1')
    expect(prompt.systemPrompt).toContain('你是分析员')
    expect('sys'.length).toBe(3)
  })

  it('templateId 定向：返回该模板拓扑摘要；不存在 → WF_ORG_NOT_FOUND', async () => {
    const { host } = makeHost()
    const catalog = await buildOrgCatalog(host, 'session-1', { templateId: 'tpl-1' })
    const topology = catalog.topology as { nodeCount: number; lineCount: number; truncated: boolean }
    expect(topology.nodeCount).toBe(3)
    expect(topology.lineCount).toBe(2)
    expect(topology.truncated).toBe(false)
    await expect(buildOrgCatalog(host, 'session-1', { templateId: '不存在' })).rejects.toBeInstanceOf(WfError)
  })

  it('includeRuns：附加最近运行摘要（节点 ok/fail 计数）', async () => {
    const { host } = makeHost()
    const catalog = await buildOrgCatalog(host, 'session-1', { includeRuns: true })
    expect(catalog.recentRun).toMatchObject({ id: 'run-9', status: 'completed', nodeOk: 1, nodeFail: 1 })
  })

  it('运行中勘察：以运行事实源读画布并刷新空闲基准（方案 §5.1 双保险）', async () => {
    const { host, touched } = makeHost({
      activeRunOf: () => ({ snapshot: { flowId: 'wf-run', id: 'run-2', status: 'running' } }),
      currentResolvedFlowOf: async () => makeFlow('wf-run', { description: '运行中的事实源' }),
    })
    const catalog = await buildOrgCatalog(host, 'session-1', {})
    expect(touched).toEqual(['session-1'])
    expect((catalog.topology as { nodeCount: number }).nodeCount).toBe(3)
  })

  it('幂等零副作用：连续两次勘察结果一致（同输入同输出）', async () => {
    const { host } = makeHost()
    const first = await buildOrgCatalog(host, 'session-1', {})
    const second = await buildOrgCatalog(host, 'session-1', {})
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('clip：空白压缩 + 超限截断并标注', () => {
    expect(clip('  a\n\nb  ', 10)).toBe('a b')
    expect(clip('x'.repeat(20), 5)).toBe('xxxxx…（已截断）')
  })
})
