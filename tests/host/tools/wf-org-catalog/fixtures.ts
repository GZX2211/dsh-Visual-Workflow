// tests/host/tools/wf-org-catalog/fixtures.ts
//
// wf_org_catalog 单测共用工厂：工作流/角色资产索引摘要、覆盖全部节点种类的资产详情样本、
// 经验条目、宿主 fake（含取数调用计数）。
// 只提供最小可复用样本，具体断言由各测试自持（不在这里预置期望值）。

import type {
  ExperienceEntry,
  ExperienceIndexEntry,
  RoleAssetDetail,
  RoleAssetSummary,
  WorkflowAssetDetail,
  WorkflowAssetSummary,
} from '../../../../src/host/shared/asset-types.js'
import type { GraphNode, Line, RoleNode } from '../../../../src/host/shared/graph-model.js'
import type { OrgCatalogHost } from '../../../../src/host/tools/wf-org-catalog/tool.js'

/** 工作流资产索引条目。 */
export function workflowAssetSummaryFixture(overrides: Partial<WorkflowAssetSummary> = {}): WorkflowAssetSummary {
  return {
    assetId: 'flow-1',
    versionId: 2,
    name: '评审流程',
    description: '带评审回环的三阶段流程',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/**
 * 角色资产索引条目。
 * 摘要由资产库在列表查询里 JOIN Active 版本行截断产出（前 60 字 + 截断标记），
 * 目录侧只做原样透传，因此 fixture 直接给 `summary`，不再模拟 systemPrompt。
 */
export function roleAssetSummaryFixture(overrides: Partial<RoleAssetSummary> = {}): RoleAssetSummary {
  return {
    assetId: 'role-1',
    versionId: 3,
    name: '分析员',
    kind: 'agent',
    roleAssetType: 'standalone',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 角色资产详情（systemPrompt 完整）。 */
export function roleAssetDetailFixture(overrides: Partial<RoleAssetDetail> = {}): RoleAssetDetail {
  return {
    assetId: 'role-1',
    versionId: 3,
    rowId: 'rar-1',
    kind: 'agent',
    roleAssetType: 'standalone',
    name: '分析员',
    systemPrompt: '你是分析员',
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoning: 'high',
    presetId: 'combo-1',
    retryLimit: 3,
    inputSchema: '上游结论',
    outputSchema: '分析报告路径',
    systemPromptSource: '分析员.md',
    referenceWorkflowIds: [],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 覆盖全部节点种类与数据源字段的工作流资产详情（含内联协作组、闸门虚拟节点、服务器库）。 */
export function workflowAssetDetailFixture(overrides: Partial<WorkflowAssetDetail> = {}): WorkflowAssetDetail {
  const nodes: GraphNode[] = [
    { id: 's', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
    {
      id: 'a1',
      kind: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: '分析员',
        systemPrompt: '你是分析员',
        provider: 'deepseek',
        model: 'deepseek-chat',
        presetId: 'combo-1',
        reasoning: 'high',
        retryLimit: 3,
        reactLimit: null,
        inputSchema: '上游结论',
        outputSchema: '分析报告路径',
        groupId: 'g1',
        systemPromptSource: '角色说明.md',
        injectSystemPrompt: false,
        injectToolSections: false,
      },
    },
    {
      id: 'g1',
      kind: 'group',
      position: { x: 0, y: 0 },
      data: { label: '评审组', collabPrompt: '组员互相评审', memberIds: ['a1'] },
    },
    {
      id: 'p1',
      kind: 'proxy',
      position: { x: 0, y: 0 },
      proxySourceId: 'a1',
      data: { label: '里程碑复核', role: 'milestone' },
    },
    { id: 'f1', kind: 'file', position: { x: 0, y: 0 }, data: { label: '基线说明', fileKind: 'text', content: '基线正文' } },
    {
      id: 'db1',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: { label: '本地库', description: '本地数据', dbType: 'local', dbKind: 'sqlite', localPath: 'D:/data.db' },
    },
    {
      id: 'db2',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: {
        label: '服务器库',
        description: '远端只读',
        dbType: 'server',
        dbKind: 'postgresql',
        conn: { host: 'db.internal', port: 5432, user: 'reader', password: 'secret', db: 'shop' },
      },
    },
    { id: 'pz', kind: 'pause', position: { x: 0, y: 0 }, data: { label: '暂停' } },
    { id: 'e', kind: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } },
  ]
  const lines: Line[] = [
    { id: 'l1', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { id: 'l2', source: 'f1', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
    { id: 'l3', source: 'a1', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'fail' } },
    { id: 'l4', source: 'db1', target: 'db2', sourceHandle: 'db-out', targetHandle: 'db-in' },
  ]
  return {
    assetId: 'flow-1',
    versionId: 2,
    rowId: 'war-2',
    mode: 'mode1',
    name: '评审流程',
    description: '带评审回环的三阶段流程',
    nodes,
    lines,
    meta: { nodeMax: 12 },
    roleVersionIds: [{ nodeId: 'a1', roleVersionId: 'rar-1' }],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 工作流资产里的角色节点样本（buildInlineRoleDetail 入参）。 */
export function inlineRoleNodeFixture(): RoleNode {
  return workflowAssetDetailFixture().nodes.find((node) => node.id === 'a1') as RoleNode
}

/** 经验索引条目。 */
export function experienceIndexFixture(overrides: Partial<ExperienceIndexEntry> = {}): ExperienceIndexEntry {
  return { id: 'ex-1', taskContext: '重构一个 TypeScript 插件的存储层', ...overrides }
}

/** 经验条目（完整内容；缺省活跃——入库即进入召回面）。 */
export function experienceFixture(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: 'ex-1',
    active: true,
    sourceRunId: 'run-1',
    reflectionPromptVersion: '1',
    taskType: '软件开发',
    taskContext: '重构一个 TypeScript 插件的存储层',
    insight: '先冻结共享契约，再并行改造各模块',
    evidence: '上一轮因为契约漂移导致两端各自维护了一份字段表',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    ...overrides,
  }
}

/** 宿主 fake 的取数调用计数（批内缓存 / 批量取数断言的观测面）。 */
export interface CatalogHostCalls {
  workflowLists: number
  roleLists: number
  experienceIndexLists: number
  experienceIndexLimits: number[]
  workflowReads: string[]
  roleReads: string[]
  roleVersionReads: string[]
  experienceReads: string[][]
}

/**
 * 宿主 fake：默认提供一套完整资产与经验，并记录每次取数调用。
 * `overrides` 可替换任意资产缝方法（用于逐条错误、核心清单抛错等场景）。
 */
export function makeCatalogHost(overrides: Partial<OrgCatalogHost> = {}): {
  host: OrgCatalogHost
  calls: CatalogHostCalls
} {
  const calls: CatalogHostCalls = {
    workflowLists: 0,
    roleLists: 0,
    experienceIndexLists: 0,
    experienceIndexLimits: [],
    workflowReads: [],
    roleReads: [],
    roleVersionReads: [],
    experienceReads: [],
  }
  const defaults: OrgCatalogHost = {
    assets: {
      async listWorkflowAssets() {
        calls.workflowLists += 1
        return [workflowAssetSummaryFixture()]
      },
      async listRoleAssets() {
        calls.roleLists += 1
        return [roleAssetSummaryFixture()]
      },
      async getWorkflowAsset(assetId: string) {
        calls.workflowReads.push(assetId)
        return assetId === 'flow-1' ? workflowAssetDetailFixture() : null
      },
      async getRoleAsset(assetId: string) {
        calls.roleReads.push(assetId)
        return assetId === 'role-1' ? roleAssetDetailFixture() : null
      },
      async listExperienceIndex(limit: number) {
        calls.experienceIndexLists += 1
        calls.experienceIndexLimits.push(limit)
        return [experienceIndexFixture()]
      },
      async getExperiences(ids: string[]) {
        calls.experienceReads.push([...ids])
        return [experienceFixture()].filter((entry) => ids.includes(entry.id))
      },
      async getRoleAssetVersion(roleRowId: string) {
        calls.roleVersionReads.push(roleRowId)
        return roleRowId === 'rar-1' ? roleAssetDetailFixture({ assetId: 'role-1', versionId: 3 }) : null
      },
    },
    async listToolCombos() {
      return [{ id: 'combo-1', name: '分析组合', tools: ['read', 'write'], mcpServers: ['mcp-1'] }]
    },
    listPresets: async () => [{ id: 'standard', name: '标准', description: '官方标准模式' }],
    listModels: async () => [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: '高' }] }],
  }
  const host: OrgCatalogHost = {
    ...defaults,
    ...overrides,
    assets: { ...defaults.assets, ...(overrides.assets ?? {}) },
  }
  return { host, calls }
}
