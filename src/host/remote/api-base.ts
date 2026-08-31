// src/host/remote/api-base.ts
//
// GUI API 基础层：宿主能力缝（ApiHost）、webServer 最小结构、前端快照标记
// 剥离工具（CLIENT_META_KEYS/stripClientMeta）与端点白名单分发基类
// VisualWorkflowApiBase（constructor + ENDPOINTS + handle）。
//
// 继承链：VisualWorkflowApiBase ← VisualWorkflowApiWorkflows ←
// VisualWorkflowApiTemplates ← VisualWorkflowApiEcosystem ←
// VisualWorkflowApiCatalog ← VisualWorkflowApiRuns ← VisualWorkflowApi（api.ts 收口）。

import * as EP from '../shared/protocol.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { OrchestratorRuntime } from '../orchestrator/runtime.js'
import type { EmbeddingEngine } from '../embedding/engine.js'
import type { SchedulerEngine } from '../scheduler/engine.js'
import type { SchedulerTaskStore } from '../scheduler/task-store.js'
import { httpError } from './http.js'

/**
 * 前端快照标记字段黑名单（保存时剥除，绝不落盘）：
 *  - _draft：客户端本地草稿标记。旧实现把它随模板/服务/工作流一起写盘，
 *    刷新后已入库对象被误判为草稿（本地删除不走后端、保存行为错乱）。
 *  - _clientMeta：预留的其它客户端元数据。
 * 说明：保存逻辑以深拷贝剔除，避免污染对象本身（调用方列表仍可复用）。
 */
const CLIENT_META_KEYS = ['_draft', '_clientMeta'] as const

/** 剥离前端快照标记（浅拷贝，不修改入参）。 */
export function stripClientMeta<T extends Record<string, unknown>>(value: T): T {
  const next = { ...value }
  for (const key of CLIENT_META_KEYS) delete next[key]
  return next
}

/** 宿主能力缝（index.ts 装配；单测 fake）。 */
export interface ApiHost {
  orchestrator: OrchestratorRuntime
  store: FlowStore
  dataDir: string
  engine: EmbeddingEngine
  /** 模式二服务管理器（服务管理阶段装配；缺失时服务端点返回 501）。 */
  serviceManager?: {
    start(serviceId: string): Promise<unknown>
    stop(serviceId: string): Promise<unknown>
    status(serviceId: string): Promise<unknown>
  }
  /** 服务 apiKey（调试流式代理携带鉴权头用；null 表示未启用，密钥不落浏览器）。 */
  apiKey?: string | null
  /** 定时任务引擎（scheduler/engine.ts；缺失时调度端点返回 501）。 */
  scheduler?: SchedulerEngine
  /** 定时任务存储（scheduler/task-store.ts；缺失时调度端点返回 501）。 */
  schedulerTaskStore?: SchedulerTaskStore
}

/** webServer 服务最小结构（官方 register 契约）。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: unknown, res: unknown): Promise<void> | void
  }): () => void
}

/**
 * GUI API 分发基类：按端点名分发（白名单禁止命中原型链方法）。
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
