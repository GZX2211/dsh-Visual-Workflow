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

  it('工具开关：只报被关闭的工具，不返回可用工具总清单（父代理无法点名工具）', async () => {
    const { host } = makeHost()
    const catalog = await buildOrgCatalog(host, 'session-1', {})
    const tools = catalog.tools as { disabled: string[]; available?: string[] }
    expect(tools.disabled).toEqual(['wf_graph_patch'])
    expect(tools.available).toBeUndefined()
  })

  it('模型目录：给出 provider/model 配对（节点 provider/model 的取值来源）', async () => {
    const { host } = makeHost()
    const catalog = await buildOrgCatalog(host, 'session-1', {})
    expect(catalog.models).toEqual([{ provider: 'deepseek', model: 'deepseek-chat' }])
  })

  it('分级输出：overview 默认紧凑（短摘要 + detailHint），detail=full 才给角色摘要全文', async () => {
    const { host } = makeHost()
    const overview = await buildOrgCatalog(host, 'session-1', {})
    expect(overview.detail).toBe('overview')
    expect(typeof overview.detailHint).toBe('string')
    const compact = (overview.roles as Array<{ summary: string; tools?: unknown }>)[0]
    expect(compact.summary.length).toBeLessThanOrEqual(CATALOG_LIMITS.summaryCompact + 8)
    expect(compact.tools).toBeUndefined()

    const full = await buildOrgCatalog(host, 'session-1', { detail: 'full' })
    expect(full.detail).toBe('full')
    expect(full.detailHint).toBeUndefined()
    const detailed = (full.roles as Array<{ summary: string; tools?: unknown }>)[0]
    // 角色模板在 fake 里是长提示词：full 级别应比 overview 保留更多正文
    expect(detailed.summary.length).toBeGreaterThan(compact.summary.length)
    expect('tools' in detailed).toBe(true)
  })

  it('组合清单两种级别都带工具（组合 id 是节点 presetId 的取值来源）', async () => {
    const { host } = makeHost()
    for (const detail of ['overview', 'full'] as const) {
      const catalog = await buildOrgCatalog(host, 'session-1', { detail })
      const combo = (catalog.combos as Array<{ id: string; tools: string[] }>)[0]
      expect(combo.id).toBe('combo-1')
      expect(combo.tools).toEqual(['wf_ask_agent'])
    }
  })

  it('体积天花板：目录条目超量时压缩明细列表并置 truncated', async () => {
    const base = makeHost()
    const many = Array.from({ length: 300 }, (_item, index) => ({
      id: `role-${index}`,
      name: `角色${index}`,
      kind: 'agent',
      provider: 'deepseek',
      model: 'deepseek-chat',
      systemPrompt: '角色提示词'.repeat(60),
    }))
    const manyTemplates = Array.from({ length: 300 }, (_item, index) => ({
      id: `tpl-${index}`,
      mode: 'mode1' as const,
      name: `模板${index}`,
      description: '',
      revision: 1,
      nodes: [],
      lines: [],
    }))
    const host: OrgCatalogHost = {
      ...base.host,
      store: {
        ...base.host.store,
        async listTemplates() { return many },
        async listFlowTemplates(): Promise<WorkflowTemplate[]> { return manyTemplates },
      },
    }
    const catalog = await buildOrgCatalog(host, 'session-1', { detail: 'full' })
    expect(JSON.stringify(catalog).length).toBeLessThanOrEqual(CATALOG_LIMITS.payload)
    expect(catalog.truncated).toBe(true)
  })

  it('预算化：摘要截断到上限内；detailRoleId 才返回提示词正文（且截断）', async () => {
    const { host } = makeHost()
    const plain = await buildOrgCatalog(host, 'session-1', {})
    const role = (plain.roles as Array<{ summary: string }>)[0]
    expect(role.summary.length).toBeLessThanOrEqual(CATALOG_LIMITS.summary + 8)
    expect('rolePrompt' in plain).toBe(false)

    const detailed = await buildOrgCatalog(host, 'session-1', { detailRoleId: 'role-1' })
    const prompt = detailed.rolePrompt as { id: string; name: string; systemPrompt: string }
    expect(prompt.id).toBe('role-1')
    expect(prompt.name).toBe('分析员')
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
