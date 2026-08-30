// src/host/remote/api-runs.ts
//
// GUI API 运行、数据库与导入导出端点（VisualWorkflowApiRuns extends Catalog）：
// 运行启停/状态/历史/断点续跑、数据库连接测试/表结构/检索预览、v2 bundle
// 导入导出与角色模板往返。方法体逐字移动。

import type { DatabaseNode } from '../shared/graph-model.js'
import { findResumableRun } from '../orchestrator/resume.js'
import { buildIndexForDatabase, createDatabaseDriver, indexPathOf, testDatabaseConnection } from '../tools/data-tools.js'
import { VectorIndex } from '../embedding/indexer.js'
import { exportAgentTemplate, exportWorkflowBundle, importAgentTemplate, importWorkflowBundle } from './transfer.js'
import { httpError } from './http.js'
import { VisualWorkflowApiCatalog } from './api-catalog.js'

export class VisualWorkflowApiRuns extends VisualWorkflowApiCatalog {
  // ---------- 运行（父代理编排） ----------

  /** 启动运行：存在可恢复断点（暂停/中断）时自动续跑，否则全新启动。 */
  async run(args: { sessionId?: unknown; flowId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const flowId = String(args?.flowId ?? '')
    if (!sessionId || !flowId) throw httpError(400, 'requires sessionId and flowId')
    const prev = await findResumableRun(this.host.store, { sessionId, flowId })
    if (prev) {
      return this.host.orchestrator.resumeRun({ sessionId, flowId, fromRunId: prev.id })
    }
    return this.host.orchestrator.startRun({ sessionId, flowId })
  }

  /** 运行状态轮询：内存快照优先，终态（内存已释放）回退磁盘历史。会话归属校验。 */
  async runStatus(args: { sessionId?: unknown; runId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const runId = String(args?.runId ?? '')
    if (!sessionId || !runId) throw httpError(400, 'requires sessionId and runId')
    const snapshot = this.host.orchestrator.runSnapshot(runId)
    if (snapshot) {
      if (snapshot.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
      return snapshot
    }
    const disk = await this.host.store.getRun(runId)
    if (!disk || disk.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
    return disk
  }

  /** 会话活跃 run 列表（workbench 进入时自动选中运行中实例用；running/paused 保留锁）。 */
  async activeRuns(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    if (!sessionId) throw httpError(400, 'requires sessionId')
    return this.host.orchestrator.activeRunsForSession(sessionId)
  }

  async runStop(args: { sessionId?: unknown; runId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const runId = String(args?.runId ?? '')
    if (!sessionId || !runId) throw httpError(400, 'requires sessionId and runId')
    // 会话归属校验：内存激活 run 直接比对；已释放的终态 run 回退磁盘比对
    // （越权会话不得停止他人运行；不匹配按不存在处理，不泄露 runId 是否存在）。
    const entry = this.host.orchestrator.entryFor(runId)
    if (entry) {
      if (entry.snapshot.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
      await this.host.orchestrator.stopRun(runId)
      return { stopped: true }
    }
    const disk = await this.host.store.getRun(runId)
    if (!disk || disk.sessionId !== sessionId) throw httpError(404, `运行不存在：${runId}`)
    // 终态幂等：磁盘记录存在且归属匹配 → 视为已停止
    return { stopped: true }
  }

  async runHistory(args: { sessionId?: unknown; flowId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const flowId = String(args?.flowId ?? '')
    if (!sessionId || !flowId) throw httpError(400, 'requires sessionId and flowId')
    // 会话隔离（Bug 14）：运行历史必须限定当前会话，否则可按 flowId 读到
    // 其他会话的 run 记录（多租户隔离，架构文档 §9）。
    return this.host.store.listRuns(flowId, sessionId)
  }

  /** 断点续跑（历史面板「恢复」入口；runId 缺省取该工作流最近可恢复记录）。 */
  async runResume(args: { sessionId?: unknown; flowId?: unknown; runId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const flowId = String(args?.flowId ?? '')
    if (!sessionId || !flowId) throw httpError(400, 'requires sessionId and flowId')
    const result = await this.host.orchestrator.resumeRun({
      sessionId,
      flowId,
      ...(args?.runId ? { fromRunId: String(args.runId) } : {}),
    })
    return result
  }
  // ---------- 数据库（GUI 面板） ----------

  /** 连接测试（本地/服务器驱动均可；返回可展示消息）。 */
  async dbTest(args: { node?: unknown }): Promise<unknown> {
    const node = args?.node as DatabaseNode | null | undefined
    if (!node || node.kind !== 'database') throw httpError(400, 'requires a database node')
    return testDatabaseConnection(node)
  }

  /** 表结构预览（只读）。 */
  async dbSchema(args: { node?: unknown }): Promise<unknown> {
    const node = args?.node as DatabaseNode | null | undefined
    if (!node || node.kind !== 'database') throw httpError(400, 'requires a database node')
    const driver = createDatabaseDriver(node)
    try {
      return await driver.schema()
    } finally {
      driver.close()
    }
  }

  /**
   * 检索预览：命中索引直接检索；索引缺失或 rebuild=true 时先构建（本地库）。
   * 嵌入不可用时索引自动落 BM25（结果标注 source）。
   */
  async dbSearchPreview(args: { dataId?: unknown; query?: unknown; topK?: unknown; node?: unknown; rebuild?: unknown }): Promise<unknown> {
    const dataId = String(args?.dataId ?? '')
    const query = String(args?.query ?? '').trim()
    if (!dataId) throw httpError(400, 'requires dataId')
    const node = args?.node as DatabaseNode | null | undefined
    const vectorOptions = node?.data?.vectorOptions
    const topK = Number(args?.topK ?? 5) || Number(vectorOptions?.topK) || 5
    const index = new VectorIndex(indexPathOf(this.host.dataDir, dataId))
    if (args?.rebuild === true || (await index.load()) === null) {
      if (!node || node.kind !== 'database') throw httpError(422, '索引不存在且未提供数据库节点，无法构建')
      await buildIndexForDatabase(this.host.dataDir, node, this.host.engine)
    }
    if (!query) return { dataId, hits: [] }
    const result = await index.search(query, topK, this.host.engine, { threshold: Number(vectorOptions?.scoreThreshold) || 0 })
    return { dataId, ...(result ?? { hits: [] }) }
  }
  // ---------- 导入导出（v2 bundle） ----------

  async exportWorkflow(args: { sessionId?: unknown; id?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const id = String(args?.id ?? '')
    if (!sessionId || !id) throw httpError(400, 'requires sessionId and id')
    return { json: await exportWorkflowBundle(this.host.store, sessionId, id) }
  }

  async importWorkflow(args: { json?: unknown; conflictMode?: unknown }): Promise<unknown> {
    // 图2 交互改造：导入一律落为「工作流模板」（全局共享），不再直接创建实例——
    // 用户需在画布中「创建实例」后才能运行（sessionId 参数不再需要）。
    return importWorkflowBundle(this.host.store, args?.json, {
      conflictMode: args?.conflictMode as 'rename' | 'overwrite' | undefined,
    })
  }

  async exportAgentTemplate(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return { json: await exportAgentTemplate(this.host.store, id) }
  }

  async importAgentTemplate(args: { json?: unknown; conflictMode?: unknown }): Promise<unknown> {
    return importAgentTemplate(this.host.store, args?.json, {
      conflictMode: args?.conflictMode as 'rename' | 'overwrite' | undefined,
    })
  }
}