// tests/host/api/fixtures/api-harness.ts
//
// GUI API 边界测试共享夹具：真实 FlowStore（临时目录）+ fake 编排运行时与 fake 生态服务，
// 以及各端点组共用的图文档构造器。
//
// 资源回收约定：夹具创建的资源登记在 `cleanups`，使用方在测试文件内 `afterEach(cleanupAll)`；
// 使用 DSH_HOME 的用例另用 `snapshotDshHome()` 保存/恢复环境变量。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../../../src/host/storage/flow-store.js'
import {
  OrchestratorRuntime,
  type AgentHost,
  type NodeRunner,
  type NodeStartInput,
  type OrchestratorConfig,
  type RootAgentLike,
  type RootInjectedMessage,
  type TurnEndInfo,
} from '../../../../src/host/orchestrator/index.js'
import { VisualWorkflowApi, type ApiHost } from '../../../../src/host/api/index.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import type { DatabaseNode, RoleNode, StageNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import type { EmbeddingEngine } from '../../../../src/host/embedding/engine.js'
import type {
  AssetVersionEntry,
  ExperienceEntry,
  ExperiencePatch,
  RoleAssetDetail,
  RoleAssetReference,
  RoleAssetSummary,
  WorkflowAssetDetail,
  WorkflowAssetSummary,
} from '../../../../src/host/shared/asset-types.js'
import { ERR_ASSET_NOT_FOUND, ERR_ASSET_VERSION_NOT_FOUND, ERR_EXPERIENCE_NOT_FOUND } from '../../../../src/host/shared/protocol.js'

/** 资产库能力缝（从宿主能力缝派生，避免测试夹具自建第二份资产契约）。 */
export type FakeAssets = NonNullable<ApiHost['assets']>

/** 经验域能力缝（同样从宿主能力缝派生，与边界声明的形状零漂移）。 */
export type FakeExperienceDomainFace = NonNullable<ApiHost['experience']>

/** 能力缝入参/出参按方法签名派生（与宿主能力缝零漂移）。 */
type RolePromoteInput = Parameters<FakeAssets['promoteRole']>[0]
type WorkflowPromoteInput = Parameters<FakeAssets['promoteWorkflow']>[0]
type RoleSaveInput = Parameters<FakeAssets['saveRoleVersion']>[0]
type WorkflowSaveInput = Parameters<FakeAssets['saveWorkflowVersion']>[0]
type AssetPromoteResult = Awaited<ReturnType<FakeAssets['promoteRole']>>

/** 待回收资源（测试文件 afterEach 经 cleanupAll 回收）。 */
export const cleanups: Array<() => Promise<void>> = []

/** 回收全部登记资源（可重复调用）。 */
export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
}

/** 保存当前 DSH_HOME 并返回恢复函数（MCP 托管区/插件目录用例共用）。 */
export function snapshotDshHome(): () => void {
  const saved = process.env.DSH_HOME
  return () => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
}

export function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

export function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

export function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-pause', 'pause'), agent('n-a2', '子任务B'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

export function databaseNode(id: string, localPath: string): DatabaseNode {
  return {
    id,
    kind: 'database',
    position: { x: 0, y: 0 },
    data: { label: '本地库', description: '', dbType: 'local', dbKind: 'sqlite', localPath },
  }
}

export class FakeRoot implements RootAgentLike {
  id: string
  status = 'idle'
  messages: RootInjectedMessage[] = []
  session: { events: unknown[] } = { events: [] }
  constructor(id: string) {
    this.id = id
  }
}

export class FakeAgents implements AgentHost {
  roots = new Map<string, FakeRoot>()
  available(): boolean {
    return true
  }
  getRootAgent(id: string): RootAgentLike | null {
    return this.roots.get(id) ?? null
  }
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void {
    ;(agent as FakeRoot).messages.push(message)
  }
  latestTurnEnd(): TurnEndInfo | null {
    return null
  }
  childRunning(): boolean {
    return false
  }
}

export class FakeRunner implements NodeRunner {
  calls: NodeStartInput[] = []
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    this.calls.push(input)
    return { childId: `child-${this.calls.length}`, created: true }
  }
  async interruptChild(): Promise<void> {}
}

/** 端点测试上下文（fake 生态服务可注入）。 */
export interface CtxLike {
  get(name: string): unknown
}

export class FakeCtx implements CtxLike {
  services = new Map<string, unknown>()
  get(name: string): unknown {
    return this.services.get(name)
  }
}

export interface Harness {
  api: VisualWorkflowApi
  host: ApiHost
  runtime: OrchestratorRuntime
  store: FlowStore
  ctx: FakeCtx
  dataDir: string
}

export interface HarnessOptions {
  /** 编排配置覆盖（既有用例传 Partial<OrchestratorConfig> 的写法保持可用）。 */
  config?: Partial<OrchestratorConfig>
  /** 资产库能力缝注入（伪资产库；缺省不装配，用于 501 路径）。 */
  assets?: FakeAssets
  /** 经验域能力缝注入（伪经验域；缺省不装配，用于 501 路径）。 */
  experience?: FakeExperienceDomainFace
}

export interface RoleSeed {
  assetId: string
  versionId?: number
  rowId?: string
  name: string
  sourceTemplateId?: string
  /** 入库来源指纹（与摘要条目同源；真实实现由 SQLite 索引行承载）。 */
  sourceFingerprint?: string
  roleAssetType?: RoleAssetDetail['roleAssetType']
  referenceWorkflowIds?: string[]
  systemPrompt?: string
  provider?: string
  model?: string
}

export interface WorkflowSeed {
  assetId: string
  versionId?: number
  rowId?: string
  name: string
  sourceTemplateId?: string
  sourceFingerprint?: string
  description?: string
}

/**
 * 伪资产库：只记录调用与返回可控数据，按 assets 模块公共入口的形状实现（结构兼容由
 * `implements FakeAssets` 锁定）。资产事实的真伪不属本层测试范围——边界只负责翻译。
 */
export class FakeAssetStore implements FakeAssets {
  /** 调用痕迹（断言「边界传了什么」用）。 */
  calls: { promoteRole: unknown[]; promoteWorkflow: unknown[]; saveRole: unknown[]; saveWorkflow: unknown[]; rollback: unknown[]; retired: string[]; restored: string[]; preview: unknown[] } = {
    promoteRole: [],
    promoteWorkflow: [],
    saveRole: [],
    saveWorkflow: [],
    rollback: [],
    retired: [],
    restored: [],
    preview: [],
  }
  /** 下一次入库/保存抛出的领域错误（重复入库 409 路径用）。 */
  nextPromoteError: Error | null = null
  /** 下一次影响面预览返回的牵连清单（缺省空 = 无牵连）。 */
  nextPreviewAffected: RoleAssetReference[] = []
  roleAssets = new Map<string, RoleAssetDetail>()
  workflowAssets = new Map<string, WorkflowAssetDetail>()
  /** 已归档资产（真实实现由「有历史行、无 Active 行」表达；夹具用独立表表达同一事实）。 */
  retiredRoleAssets = new Map<string, RoleAssetDetail>()
  retiredWorkflowAssets = new Map<string, WorkflowAssetDetail>()
  roleVersions = new Map<string, AssetVersionEntry[]>()
  workflowVersions = new Map<string, AssetVersionEntry[]>()
  /** 入库时记录的来源指纹（索引条目回填用；真实实现由 SQLite 索引行承载）。 */
  roleFingerprints = new Map<string, string>()
  workflowFingerprints = new Map<string, string>()
  /** 登记一个角色资产（Active 版本 v1；内容最简，测试按需覆盖）。 */
  seedRole(seed: RoleSeed): RoleAssetDetail {
    const versionId = seed.versionId ?? 1
    const detail: RoleAssetDetail = {
      assetId: seed.assetId,
      versionId,
      rowId: seed.rowId ?? `${seed.assetId}-r${versionId}`,
      kind: 'agent',
      roleAssetType: seed.roleAssetType ?? 'standalone',
      name: seed.name,
      systemPrompt: seed.systemPrompt ?? `提示词：${seed.name}`,
      provider: '',
      model: '',
      retryLimit: 3,
      referenceWorkflowIds: seed.referenceWorkflowIds ?? [],
      createdAt: 1_700_000_000_000,
      ...(seed.sourceTemplateId === undefined ? {} : { sourceTemplateId: seed.sourceTemplateId }),
    }
    this.roleAssets.set(seed.assetId, detail)
    this.roleVersions.set(seed.assetId, [
      { versionId, rowId: detail.rowId, name: detail.name, createdAt: detail.createdAt, source: 'human', active: true },
    ])
    this.setRoleFingerprint(seed.assetId, seed.sourceFingerprint)
    return detail
  }

  /** 登记一个工作流资产（Active 版本 v1；图内容最简）。 */
  seedWorkflow(seed: WorkflowSeed): WorkflowAssetDetail {
    const versionId = seed.versionId ?? 1
    const detail: WorkflowAssetDetail = {
      assetId: seed.assetId,
      versionId,
      rowId: seed.rowId ?? `${seed.assetId}-r${versionId}`,
      mode: 'mode1',
      name: seed.name,
      description: seed.description ?? '',
      nodes: [],
      lines: [],
      roleVersionIds: [],
      createdAt: 1_700_000_000_000,
      ...(seed.sourceTemplateId === undefined ? {} : { sourceTemplateId: seed.sourceTemplateId }),
    }
    this.workflowAssets.set(seed.assetId, detail)
    this.workflowVersions.set(seed.assetId, [
      { versionId, rowId: detail.rowId, name: detail.name, createdAt: detail.createdAt, source: 'human', active: true },
    ])
    this.setWorkflowFingerprint(seed.assetId, seed.sourceFingerprint)
    return detail
  }

  /** 记录来源指纹（undefined 表示该资产非模版晋升：索引条目不携带来源指纹）。 */
  private setRoleFingerprint(assetId: string, fingerprint: string | undefined): void {
    if (fingerprint === undefined) this.roleFingerprints.delete(assetId)
    else this.roleFingerprints.set(assetId, fingerprint)
  }

  private setWorkflowFingerprint(assetId: string, fingerprint: string | undefined): void {
    if (fingerprint === undefined) this.workflowFingerprints.delete(assetId)
    else this.workflowFingerprints.set(assetId, fingerprint)
  }

  /** 追加一个角色版本并把它设为 Active（历史版本条目保留，与被测语义一致）。 */
  private appendRoleVersion(assetId: string, versionId: number, rowId: string): AssetVersionEntry {
    const entries = this.roleVersions.get(assetId) ?? []
    const entry: AssetVersionEntry = { versionId, rowId, name: this.roleAssets.get(assetId)?.name ?? '', createdAt: 1_700_000_000_000 + versionId, source: 'human', active: true }
    this.roleVersions.set(assetId, [...entries.map((item) => ({ ...item, active: false })), entry])
    return entry
  }

  /** 追加一个工作流版本并把它设为 Active。 */
  private appendWorkflowVersion(assetId: string, versionId: number, rowId: string): AssetVersionEntry {
    const entries = this.workflowVersions.get(assetId) ?? []
    const entry: AssetVersionEntry = { versionId, rowId, name: this.workflowAssets.get(assetId)?.name ?? '', createdAt: 1_700_000_000_000 + versionId, source: 'human', active: true }
    this.workflowVersions.set(assetId, [...entries.map((item) => ({ ...item, active: false })), entry])
    return entry
  }

  /** 索引条目与详情同源：来源指纹只有入库路径会写，故由 seed 显式携带。 */
  private roleSummaryOf(detail: RoleAssetDetail, sourceFingerprint?: string): RoleAssetSummary {
    return {
      assetId: detail.assetId,
      versionId: detail.versionId,
      name: detail.name,
      kind: detail.kind,
      roleAssetType: detail.roleAssetType,
      updatedAt: detail.createdAt,
      ...(detail.sourceTemplateId === undefined ? {} : { sourceTemplateId: detail.sourceTemplateId }),
      ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    }
  }

  private workflowSummaryOf(detail: WorkflowAssetDetail, sourceFingerprint?: string): WorkflowAssetSummary {
    return {
      assetId: detail.assetId,
      versionId: detail.versionId,
      name: detail.name,
      description: detail.description,
      updatedAt: detail.createdAt,
      ...(detail.sourceTemplateId === undefined ? {} : { sourceTemplateId: detail.sourceTemplateId }),
      ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    }
  }

  async listRoleAssets(): Promise<RoleAssetSummary[]> {
    return [...this.roleAssets.values()].map((detail) => this.roleSummaryOf(detail, this.roleFingerprints.get(detail.assetId)))
  }

  async listRetiredRoleAssets(): Promise<RoleAssetSummary[]> {
    return [...this.retiredRoleAssets.values()].map((detail) => this.roleSummaryOf(detail, this.roleFingerprints.get(detail.assetId)))
  }

  async getRoleAsset(assetId: string): Promise<RoleAssetDetail | null> {
    // 归档资产仍可读（取最新版本行）——UI 的历史资产属性栏依赖它
    return this.roleAssets.get(assetId) ?? this.retiredRoleAssets.get(assetId) ?? null
  }

  async listRoleVersions(assetId: string): Promise<AssetVersionEntry[]> {
    return this.roleVersions.get(assetId) ?? []
  }

  async rollbackRoleAsset(assetId: string, versionId: number): Promise<RoleAssetDetail> {
    this.calls.rollback.push({ kind: 'role', assetId, versionId })
    const retired = this.retiredRoleAssets.get(assetId)
    const detail = this.roleAssets.get(assetId) ?? retired
    const version = (this.roleVersions.get(assetId) ?? []).find((item) => item.versionId === versionId)
    if (!detail || !version) throw this.versionNotFound(assetId, versionId)
    // 归档资产的回滚 = 重新启用（移回活跃表），与真实实现同语义
    const rolled = { ...detail, versionId, rowId: version.rowId }
    delete rolled.retired
    if (retired) this.retiredRoleAssets.delete(assetId)
    this.roleAssets.set(assetId, rolled)
    return rolled
  }

  async retireRoleAsset(assetId: string): Promise<void> {
    this.calls.retired.push(`role:${assetId}`)
    const detail = this.roleAssets.get(assetId)
    if (!detail) return
    this.roleAssets.delete(assetId)
    this.retiredRoleAssets.set(assetId, { ...detail, retired: true })
  }

  /** 恢复：取最新版本条目重建 Active 行（与真实实现同语义：只回到活跃面，不接版本号）。 */
  async restoreRoleAsset(assetId: string): Promise<RoleAssetDetail> {
    this.calls.restored.push(`role:${assetId}`)
    const retired = this.retiredRoleAssets.get(assetId)
    if (!retired) {
      const live = this.roleAssets.get(assetId)
      if (!live) throw this.assetNotFound(assetId)
      return live
    }
    const latest = [...(this.roleVersions.get(assetId) ?? [])].sort((a, b) => b.versionId - a.versionId)[0]
    const restored: RoleAssetDetail = { ...retired, versionId: latest?.versionId ?? retired.versionId, rowId: latest?.rowId ?? retired.rowId }
    delete restored.retired
    this.retiredRoleAssets.delete(assetId)
    this.roleAssets.set(assetId, restored)
    return restored
  }

  async listWorkflowAssets(): Promise<WorkflowAssetSummary[]> {
    return [...this.workflowAssets.values()].map((detail) => this.workflowSummaryOf(detail, this.workflowFingerprints.get(detail.assetId)))
  }

  async listRetiredWorkflowAssets(): Promise<WorkflowAssetSummary[]> {
    return [...this.retiredWorkflowAssets.values()].map((detail) => this.workflowSummaryOf(detail, this.workflowFingerprints.get(detail.assetId)))
  }

  async getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null> {
    return this.workflowAssets.get(assetId) ?? this.retiredWorkflowAssets.get(assetId) ?? null
  }

  async listWorkflowVersions(assetId: string): Promise<AssetVersionEntry[]> {
    return this.workflowVersions.get(assetId) ?? []
  }

  async rollbackWorkflowAsset(assetId: string, versionId: number): Promise<WorkflowAssetDetail> {
    this.calls.rollback.push({ kind: 'workflow', assetId, versionId })
    const retired = this.retiredWorkflowAssets.get(assetId)
    const detail = this.workflowAssets.get(assetId) ?? retired
    const version = (this.workflowVersions.get(assetId) ?? []).find((item) => item.versionId === versionId)
    if (!detail || !version) throw this.versionNotFound(assetId, versionId)
    const rolled = { ...detail, versionId, rowId: version.rowId }
    delete rolled.retired
    if (retired) this.retiredWorkflowAssets.delete(assetId)
    this.workflowAssets.set(assetId, rolled)
    return rolled
  }

  async retireWorkflowAsset(assetId: string): Promise<void> {
    this.calls.retired.push(`workflow:${assetId}`)
    const detail = this.workflowAssets.get(assetId)
    if (!detail) return
    this.workflowAssets.delete(assetId)
    this.retiredWorkflowAssets.set(assetId, { ...detail, retired: true })
  }

  /** 恢复：取最新版本条目重建 Active 行（语义同 restoreRoleAsset）。 */
  async restoreWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail> {
    this.calls.restored.push(`workflow:${assetId}`)
    const retired = this.retiredWorkflowAssets.get(assetId)
    if (!retired) {
      const live = this.workflowAssets.get(assetId)
      if (!live) throw this.assetNotFound(assetId)
      return live
    }
    const latest = [...(this.workflowVersions.get(assetId) ?? [])].sort((a, b) => b.versionId - a.versionId)[0]
    const restored: WorkflowAssetDetail = { ...retired, versionId: latest?.versionId ?? retired.versionId, rowId: latest?.rowId ?? retired.rowId }
    delete restored.retired
    this.retiredWorkflowAssets.delete(assetId)
    this.workflowAssets.set(assetId, restored)
    return restored
  }

  async previewAssetCascade(input: Parameters<FakeAssets['previewAssetCascade']>[0]): Promise<RoleAssetReference[]> {
    this.calls.preview.push(input)
    return this.nextPreviewAffected
  }

  /** 模版晋升：以模版 id 作为资产 id 建首个版本（与真实实现同语义，便于测试推定 assetId）。 */
  async promoteRole(input: RolePromoteInput): Promise<AssetPromoteResult> {
    this.calls.promoteRole.push(input)
    this.throwIfInjected()
    const existing = this.roleAssets.get(input.templateId)
    if (existing) {
      return {
        assetId: existing.assetId,
        versionId: existing.versionId,
        rowId: existing.rowId,
        unchanged: true,
        roleAssetType: existing.roleAssetType,
        sharedRoleAssetIds: [],
        archivedRoleAssetIds: [],
      }
    }
    const detail = this.seedRole({
      assetId: input.templateId,
      name: input.role.name,
      sourceTemplateId: input.templateId,
      sourceFingerprint: input.fingerprint,
      systemPrompt: input.role.systemPrompt,
    })
    return {
      assetId: detail.assetId,
      versionId: detail.versionId,
      rowId: detail.rowId,
      unchanged: false,
      roleAssetType: detail.roleAssetType,
      sharedRoleAssetIds: [],
      archivedRoleAssetIds: [],
    }
  }

  async promoteWorkflow(input: WorkflowPromoteInput): Promise<AssetPromoteResult> {
    this.calls.promoteWorkflow.push(input)
    this.throwIfInjected()
    const existing = this.workflowAssets.get(input.templateId)
    if (existing) {
      return {
        assetId: existing.assetId,
        versionId: existing.versionId,
        rowId: existing.rowId,
        unchanged: true,
        sharedRoleAssetIds: [],
        archivedRoleAssetIds: [],
      }
    }
    const detail = this.seedWorkflow({
      assetId: input.templateId,
      name: input.name,
      description: input.description,
      sourceTemplateId: input.templateId,
      sourceFingerprint: input.fingerprint,
    })
    return {
      assetId: detail.assetId,
      versionId: detail.versionId,
      rowId: detail.rowId,
      unchanged: false,
      sharedRoleAssetIds: [],
      archivedRoleAssetIds: [],
    }
  }

  async saveRoleVersion(input: RoleSaveInput): Promise<AssetPromoteResult> {
    this.calls.saveRole.push(input)
    this.throwIfInjected()
    const existing = this.roleAssets.get(input.assetId) ?? this.retiredRoleAssets.get(input.assetId)
    if (!existing) throw this.assetNotFound(input.assetId)
    const versionId = existing.versionId + 1
    const rowId = `${input.assetId}-r${versionId}`
    // 归档资产的保存只迭代版本、不重建 Active 行（与真实实现同语义）
    const isRetired = !this.roleAssets.has(input.assetId)
    const saved = { ...existing, versionId, rowId, name: input.role.name, systemPrompt: input.role.systemPrompt }
    if (isRetired) this.retiredRoleAssets.set(input.assetId, saved)
    else this.roleAssets.set(input.assetId, saved)
    this.appendRoleVersion(input.assetId, versionId, rowId)
    return {
      assetId: input.assetId,
      versionId,
      rowId,
      unchanged: false,
      roleAssetType: existing.roleAssetType,
      sharedRoleAssetIds: [],
      archivedRoleAssetIds: [],
    }
  }

  async saveWorkflowVersion(input: WorkflowSaveInput): Promise<AssetPromoteResult> {
    this.calls.saveWorkflow.push(input)
    this.throwIfInjected()
    const existing = this.workflowAssets.get(input.assetId) ?? this.retiredWorkflowAssets.get(input.assetId)
    if (!existing) throw this.assetNotFound(input.assetId)
    const versionId = existing.versionId + 1
    const rowId = `${input.assetId}-r${versionId}`
    const isRetired = !this.workflowAssets.has(input.assetId)
    const saved = { ...existing, versionId, rowId, name: input.name, description: input.description }
    if (isRetired) this.retiredWorkflowAssets.set(input.assetId, saved)
    else this.workflowAssets.set(input.assetId, saved)
    this.appendWorkflowVersion(input.assetId, versionId, rowId)
    return {
      assetId: input.assetId,
      versionId,
      rowId,
      unchanged: false,
      sharedRoleAssetIds: [],
      archivedRoleAssetIds: [],
    }
  }

  private throwIfInjected(): void {
    if (!this.nextPromoteError) return
    const error = this.nextPromoteError
    this.nextPromoteError = null
    throw error
  }

  private assetNotFound(assetId: string): Error {
    return this.errorLike(`资产 ${assetId} 不存在或已退役`, ERR_ASSET_NOT_FOUND)
  }

  private versionNotFound(assetId: string, versionId: number): Error {
    return this.errorLike(`资产 ${assetId} 的版本 v${versionId} 不存在`, ERR_ASSET_VERSION_NOT_FOUND)
  }

  /** 伪造领域错误形状（只带稳定 code；HTTP 状态映射是边界职责，不在此实现）。 */
  private errorLike(message: string, code: string): Error {
    return Object.assign(new Error(message), { code })
  }
}

/**
 * 伪经验域：只记录「边界传了什么」与返回可控条目，按 api 边界声明的能力缝形状实现
 * （结构兼容由 `implements FakeExperienceDomainFace` 锁定）。
 *
 * 检索投影与向量的重算属领域职责：夹具用确定性投影模拟「保存后返回新投影字段」，
 * 让边界测试只需验证透传，不必也不得在边界层实现投影。
 */
export class FakeExperienceDomain implements FakeExperienceDomainFace {
  /** 调用痕迹（断言边界传了什么）。 */
  calls: {
    list: Array<{ limit: number }>
    update: Array<{ experienceId: string; patch: ExperiencePatch }>
    retired: string[]
    restored: string[]
  } = { list: [], update: [], retired: [], restored: [] }
  /** 经验表（无版本：id → 条目；状态由条目 active 表达）。 */
  experiences = new Map<string, ExperienceEntry>()

  /** 登记一条经验（缺省活跃；用例按需覆盖状态与字段）。 */
  seedExperience(entry: Partial<ExperienceEntry> & { id: string }): ExperienceEntry {
    const full: ExperienceEntry = {
      active: true,
      experienceType: 'agent',
      responsibility: `责任：${entry.id}`,
      taskType: '软件开发',
      decisionDomain: '实现取舍',
      situation: `情境：${entry.id}`,
      trigger: '再次遇到同类任务',
      principle: `原则：${entry.id}`,
      recommendedAction: '先补测试',
      exclusions: [],
      evidence: [],
      taskRetrievalText: `任务：${entry.id}`,
      decisionRetrievalText: `决策：${entry.id}`,
      embeddingModel: 'fake-embed',
      embeddingDimension: 4,
      sourceRunId: 'run-1',
      generationPromptId: 'prompt-1',
      generationPromptVersion: 'v1',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      ...entry,
    }
    this.experiences.set(full.id, full)
    return full
  }

  async list(input: { limit: number }): Promise<ExperienceEntry[]> {
    this.calls.list.push(input)
    return [...this.experiences.values()].slice(0, Math.max(input.limit, 0))
  }

  async update(input: { experienceId: string; patch: ExperiencePatch }): Promise<ExperienceEntry> {
    this.calls.update.push(input)
    const current = this.experiences.get(input.experienceId)
    if (!current) throw this.notFound(input.experienceId)
    const semantic: ExperienceEntry = { ...current }
    for (const [field, value] of Object.entries(input.patch)) {
      // undefined = 本次不改（跳过）；null = 清空（数组字段落库为空数组）
      if (value === undefined) continue
      ;(semantic as unknown as Record<string, unknown>)[field] = value === null ? [] : value
    }
    const updated: ExperienceEntry = { ...semantic, ...projectRetrievalOf(semantic), updatedAt: current.updatedAt + 1 }
    this.experiences.set(input.experienceId, updated)
    return updated
  }

  async retire(input: { experienceId: string }): Promise<ExperienceEntry> {
    this.calls.retired.push(input.experienceId)
    return this.setActive(input.experienceId, false)
  }

  async restore(input: { experienceId: string }): Promise<ExperienceEntry> {
    this.calls.restored.push(input.experienceId)
    return this.setActive(input.experienceId, true)
  }

  private setActive(id: string, active: boolean): ExperienceEntry {
    const current = this.experiences.get(id)
    if (!current) throw this.notFound(id)
    const updated: ExperienceEntry = { ...current, active, updatedAt: current.updatedAt + 1 }
    this.experiences.set(id, updated)
    return updated
  }

  private notFound(id: string): Error {
    return Object.assign(new Error(`经验 ${id} 不存在`), { code: ERR_EXPERIENCE_NOT_FOUND })
  }
}

/** 确定性检索投影（夹具用；真实重算在经验域，边界只透传结果）。 */
function projectRetrievalOf(entry: ExperienceEntry): Pick<ExperienceEntry, 'taskRetrievalText' | 'decisionRetrievalText'> {
  return {
    taskRetrievalText: [entry.responsibility, entry.taskType, entry.situation, entry.trigger].join(' / '),
    decisionRetrievalText: [entry.decisionDomain, entry.principle, entry.recommendedAction, entry.exclusions.join('；')].join(' / '),
  }
}

/** 构造端点测试夹具（真实 store + fake 运行时/宿主能力）。 */
export async function makeHarness(options?: HarnessOptions): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-api-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  const agents = new FakeAgents()
  agents.roots.set('session-1', new FakeRoot('session-1'))
  const runner = new FakeRunner()
  const runSeq = { n: 0 }
  const runtime = new OrchestratorRuntime({
    store,
    runner,
    agents,
    config: {
      outputFullLimit: 400,
      documentTextLimit: 200,
      runIdleTimeoutMs: 500,
      retryLimitDefault: 3,
      reactIterationLimitDefault: 50,
      wfAskAgentTimeoutMs: 500,
      ...options?.config,
    },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
    newRunId: () => {
      runSeq.n += 1
      return `run-${runSeq.n}`
    },
    uuid: () => `uuid-${runSeq.n}`,
  })
  const ctx = new FakeCtx()
  const engine: EmbeddingEngine = { source: 'bm25', dimension: 0, async ensureReady() {}, async embed() { throw new Error('bm25 only') }, dispose() {} }
  const host: ApiHost = {
    orchestrator: runtime,
    store,
    dataDir: dir,
    engine,
    ...(options?.assets ? { assets: options.assets } : {}),
    ...(options?.experience ? { experience: options.experience } : {}),
  }
  const api = new VisualWorkflowApi(ctx, host)
  return { api, host, runtime, store, ctx, dataDir: dir }
}

/** 保存流程（供运行端点）。 */
export async function saveFlow(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
}
