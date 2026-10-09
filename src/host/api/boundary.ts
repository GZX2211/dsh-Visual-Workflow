// src/host/api/boundary.ts
//
// API 边界基座：宿主能力缝（ApiHost）、端点白名单分发基类
// VisualWorkflowApiBase，以及端点组汇聚工具。
//
// 官方 webServer 的最小结构契约由 host 根横切契约提供（../web-server.js）：
// 两个 HTTP 边界必须消费同一份形状，本模块不自建第二份。
//
// 为什么端点组用组合而不是多层继承：端点组之间没有职责依赖（定时任务端点不需要
// 依赖运行端点），用继承串联只会制造伪依赖并让模块内「谁能调用谁」不可见。各组
// 只依赖本基座，最终类按显式清单汇聚原型方法（见 routes.ts）。

import * as EP from '../shared/protocol.js'
import type { AssetCascadePreviewInput, AssetPromoteResult, AssetStore } from '../assets/index.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { OrchestratorRuntime } from '../orchestrator/index.js'
import type { EmbeddingEngine } from '../embedding/engine.js'
import type { SchedulerEngine, SchedulerTaskStore } from '../scheduler/index.js'
import type { ToolSwitchStore } from '../tools/index.js'
import type {
  AssetVersionEntry,
  ExperienceEntry,
  ExperiencePatch,
  RoleAssetDetail,
  RoleAssetReference,
  RoleAssetSummary,
  WorkflowAssetDetail,
  WorkflowAssetSummary,
} from '../shared/asset-types.js'
import type { RoleTemplate } from '../shared/template-types.js'
import type { GraphNode, Line, WorkflowMode } from '../shared/graph-model.js'
import type { OrgMeta } from '../shared/org-meta.js'
import { DEFAULT_SYSTEM_LANGUAGE, isChineseSystemLanguage } from '../system-language.js'
import { httpError } from './http.js'

/**
 * 入库/保存结果的能力缝形状：字段取自资产库的 AssetPromoteResult。
 * `sharedRoleAssetIds` / `archivedRoleAssetIds` 是写路径的副作用明细（本次合并为共享的角色
 * 资产、本次因失去全部引用而自动归档的角色资产），边界只透传给 GUI 做提示，不做业务判断。
 */
type PromoteResult = Pick<
  AssetPromoteResult,
  'assetId' | 'versionId' | 'rowId' | 'unchanged' | 'roleAssetType' | 'sharedRoleAssetIds' | 'archivedRoleAssetIds'
>

/**
 * 资产库能力缝（api 边界消费的最小结构，字段类型全部取自共享资产契约）。
 * 为什么本层声明而不是直接把字段写成 AssetStore：能力缝表达的是「边界需要什么」，
 * 资产库多出的方法（经验读写等）不属边界依赖；两者的一致性由下方编译期结构校验守住。
 */
interface AssetStoreLike {
  listRoleAssets(): Promise<RoleAssetSummary[]>
  listRetiredRoleAssets(): Promise<RoleAssetSummary[]>
  getRoleAsset(assetId: string): Promise<RoleAssetDetail | null>
  listRoleVersions(assetId: string): Promise<AssetVersionEntry[]>
  rollbackRoleAsset(assetId: string, versionId: number): Promise<RoleAssetDetail>
  restoreRoleAsset(assetId: string): Promise<RoleAssetDetail>
  retireRoleAsset(assetId: string): Promise<void>
  listWorkflowAssets(): Promise<WorkflowAssetSummary[]>
  listRetiredWorkflowAssets(): Promise<WorkflowAssetSummary[]>
  getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>
  listWorkflowVersions(assetId: string): Promise<AssetVersionEntry[]>
  rollbackWorkflowAsset(assetId: string, versionId: number): Promise<WorkflowAssetDetail>
  restoreWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail>
  retireWorkflowAsset(assetId: string): Promise<void>
  previewAssetCascade(input: AssetCascadePreviewInput): Promise<RoleAssetReference[]>
  promoteRole(input: { templateId: string; fingerprint: string; role: RoleTemplate; source: 'human' | 'agent' }): Promise<PromoteResult>
  promoteWorkflow(input: {
    templateId: string
    fingerprint: string
    mode: WorkflowMode
    name: string
    description: string
    nodes: GraphNode[]
    lines: Line[]
    meta?: OrgMeta
    source: 'human' | 'agent'
  }): Promise<PromoteResult>
  saveRoleVersion(input: { assetId: string; role: RoleTemplate; source: 'human' | 'agent' }): Promise<PromoteResult>
  saveWorkflowVersion(input: {
    assetId: string
    mode: WorkflowMode
    name: string
    description: string
    nodes: GraphNode[]
    lines: Line[]
    meta?: OrgMeta
    source: 'human' | 'agent'
  }): Promise<PromoteResult>
}

/**
 * 经验域能力缝（api 边界消费的最小结构）。
 *
 * 为什么编辑只暴露语义字段补丁：保存要重算两个检索投影与向量，而重算规则（投影口径、
 * 嵌入模型可用性、判重）属经验域；边界只做「请求 → 领域调用 → 稳定响应」的翻译，
 * 因此这里既没有投影也没有相似度，领域实现由宿主装配（缺失时端点明确 501）。
 */
export interface ExperienceDomainFace {
  list(input: { limit: number }): Promise<ExperienceEntry[]>
  update(input: { experienceId: string; patch: ExperiencePatch }): Promise<ExperienceEntry>
  retire(input: { experienceId: string }): Promise<ExperienceEntry>
  restore(input: { experienceId: string }): Promise<ExperienceEntry>
}

/** 宿主能力缝（index.ts 装配；单测 fake）。 */
export interface ApiHost {
  orchestrator: OrchestratorRuntime
  store: FlowStore
  dataDir: string
  engine: EmbeddingEngine
  /** 新会话创建缝（「开启新会话」一次性动作：从模板创建实例时先新建主会话；缺失时建会话端点 501）。 */
  sessionProvider?: { createSession(options: { label: string; agentPreset?: string; cwd?: string }): Promise<string> }
  /** 解析某会话记录的工作目录（新会话继承创建者 cwd 用；不可用时省略）。 */
  sessionCwdOf?(sessionId: string): Promise<string | undefined>
  /** 模式二服务管理器（服务管理阶段装配；缺失时服务端点返回 501）。 */
  serviceManager?: {
    start(serviceId: string): Promise<unknown>
    stop(serviceId: string): Promise<unknown>
    status(serviceId: string): Promise<unknown>
  }
  /** 服务 apiKey（调试流式代理携带鉴权头用；null 表示未启用，密钥不落浏览器）。 */
  apiKey?: string | null
  /** 定时任务引擎（scheduler 模块公共入口；缺失时调度端点返回 501）。 */
  scheduler?: SchedulerEngine
  /** 定时任务存储（scheduler-tasks.json；缺失时调度端点返回 501）。 */
  schedulerTaskStore?: SchedulerTaskStore
  /** 全局工具开关存储（经 tools 模块公共入口取得；缺失时开关端点返回 501）。 */
  toolSwitches?: ToolSwitchStore
  /** 资产库能力缝（宿主注入 assets 模块的 AssetStore；缺失时资产端点返回 501）。 */
  assets?: AssetStoreLike
  /** 经验域能力缝（宿主注入经验域实现；缺失时经验端点返回 501）。 */
  experience?: ExperienceDomainFace
  /**
   * 系统语言名（宿主注入；与提示词注入共用同一次设置读取）。
   * 只表达事实：缺失时的呈现降级由 presentationOf 决定，本层不决定降级语义。
   */
  systemLanguage?: () => string
}

/**
 * 编译期结构校验：资产库公共入口的实现必须满足本能力缝；任一签名漂移都在这里报错，
 * 使「宿主注入 AssetStore」这件事可被类型系统守住（无运行时开销）。
 */
type AssertAssetStoreFits = AssetStore extends AssetStoreLike ? true : never
const assetStoreFits: AssertAssetStoreFits = true
void assetStoreFits

/**
 * 是否用中文呈现 GUI 文案（展示层语言判定的唯一入口）。
 * host 能力缝缺失时按默认语言（中文）——与插件默认中文界面一致。
 */
export function isChinesePresentation(host: ApiHost): boolean {
  return isChineseSystemLanguage(host.systemLanguage?.() ?? DEFAULT_SYSTEM_LANGUAGE)
}

/**
 * GUI 展示文案选择：中文界面取 zh，其余（未支持语言 / 读取失败）取 en。
 * 只用于展示数据；稳定错误码、状态映射与机器可读字段不在此改写。
 */
export function presentationOf(host: ApiHost, zh: string, en: string): string {
  return isChinesePresentation(host) ? zh : en
}

/**
 * 取资产库能力缝。未装配时明确 501——静默降级为「空资产库」会让用户看到
 * 「库里什么都没有」这种与事实不符的界面；资产端点与经验端点共用同一份判据。
 */
export function requireAssets(host: ApiHost): NonNullable<ApiHost['assets']> {
  const assets = host.assets
  if (!assets) {
    throw httpError(501, presentationOf(host, '资产库尚未装配（asset store unavailable）', 'Asset store is unavailable'))
  }
  return assets
}

/**
 * 取经验域能力缝。未装配时明确 501——静默返回空经验列表会让用户看到
 * 「库里没有经验」这种与事实不符的界面，也可能让保存静默失败。
 */
export function requireExperience(host: ApiHost): ExperienceDomainFace {
  const experience = host.experience
  if (!experience) {
    throw httpError(501, presentationOf(host, '经验域尚未装配（experience domain unavailable）', 'Experience domain is unavailable'))
  }
  return experience
}

/**
 * GUI API 分发基座：按端点名分发（白名单禁止命中原型链方法）。
 * 所有方法为 async (args) => value；参数缺失抛 HttpError(400)。
 */
export class VisualWorkflowApiBase {
  constructor(
    protected readonly ctx: { get(name: string): unknown },
    protected readonly host: ApiHost,
  ) {}

  /** 端点白名单（共享协议常量表派生，与共享契约零漂移）。 */
  static ENDPOINTS = new Set<string>(
    (Object.values(EP) as unknown[]).filter((value): value is string => typeof value === 'string'),
  )

  /** 按端点名分发；未知端点 404。 */
  async handle(endpoint: string, args: unknown): Promise<unknown> {
    const method = VisualWorkflowApiBase.ENDPOINTS.has(endpoint)
      ? (this as unknown as Record<string, (args: Record<string, unknown>) => Promise<unknown>>)[endpoint]
      : undefined
    if (typeof method !== 'function') throw httpError(404, `unknown endpoint: ${endpoint}`)
    return method.call(this, (args ?? {}) as Record<string, unknown>)
  }
}

/**
 * 把端点组的原型方法汇聚到最终类（组合替代继承串联）。
 * 只搬运组自身声明的方法（跳过 constructor）；基座方法仍由继承提供。
 * @param target 最终 API 类（继承基座）。
 * @param groups 端点组类清单（顺序无关，端点名必须全局唯一——冲突时后者覆盖）。
 */
export function mixInEndpointGroups(
  target: typeof VisualWorkflowApiBase,
  groups: ReadonlyArray<typeof VisualWorkflowApiBase>,
): void {
  for (const group of groups) {
    for (const key of Object.getOwnPropertyNames(group.prototype)) {
      if (key === 'constructor') continue
      const descriptor = Object.getOwnPropertyDescriptor(group.prototype, key)
      if (descriptor) Object.defineProperty(target.prototype, key, descriptor)
    }
  }
}
