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
  RoleAssetDetail,
  RoleAssetReference,
  RoleAssetSummary,
  WorkflowAssetDetail,
  WorkflowAssetSummary,
} from '../shared/asset-types.js'
import type { RoleTemplate } from '../shared/template-types.js'
import type { GraphNode, Line, WorkflowMode } from '../shared/graph-model.js'
import type { OrgMeta } from '../shared/org-meta.js'
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
  retireRoleAsset(assetId: string): Promise<void>
  listWorkflowAssets(): Promise<WorkflowAssetSummary[]>
  listRetiredWorkflowAssets(): Promise<WorkflowAssetSummary[]>
  getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null>
  listWorkflowVersions(assetId: string): Promise<AssetVersionEntry[]>
  rollbackWorkflowAsset(assetId: string, versionId: number): Promise<WorkflowAssetDetail>
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
}

/**
 * 编译期结构校验：资产库公共入口的实现必须满足本能力缝；任一签名漂移都在这里报错，
 * 使「宿主注入 AssetStore」这件事可被类型系统守住（无运行时开销）。
 */
type AssertAssetStoreFits = AssetStore extends AssetStoreLike ? true : never
const assetStoreFits: AssertAssetStoreFits = true
void assetStoreFits

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
