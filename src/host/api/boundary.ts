// src/host/api/boundary.ts
//
// API 边界基座：宿主能力缝（ApiHost）、webServer 最小结构、端点白名单分发基类
// VisualWorkflowApiBase，以及端点组汇聚工具。
//
// 为什么端点组用组合而不是多层继承：端点组之间没有职责依赖（定时任务端点不需要
// 依赖运行端点），用继承串联只会制造伪依赖并让模块内「谁能调用谁」不可见。各组
// 只依赖本基座，最终类按显式清单汇聚原型方法（见 routes.ts）。

import * as EP from '../shared/protocol.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { OrchestratorRuntime } from '../orchestrator/index.js'
import type { EmbeddingEngine } from '../embedding/engine.js'
import type { SchedulerEngine, SchedulerTaskStore } from '../scheduler/index.js'
import type { ToolSwitchStore } from '../tools/infrastructure/tool-switches.js'
import { httpError } from './http.js'

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
  /** 全局工具开关存储（tools/infrastructure/tool-switches.ts；缺失时开关端点返回 501）。 */
  toolSwitches?: ToolSwitchStore
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
