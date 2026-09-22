// src/host/storage/service-view.ts
//
// 服务文档 ↔ 模式二工作流视图的投影（纯函数：零 IO、无时钟、不改写入参）。
//
// 为什么在持久化层：服务文档与工作流文档是两类持久化形状，只有持久化层同时知道
// 两者的全部字段；把投影集中在此，避免 remote/tools/orchestrator 各自拼一遍形状
// （漏字段会静默丢数据）。写回路径（saveServiceAsFlow）在 FlowStore 内完成，
// 本文件只负责**形状映射**，不承担任何写入或语义决策。

import type { WorkflowDocument } from '../shared/graph-model.js'
import type { ServiceState } from '../shared/types.js'

/**
 * 服务文档 → 模式二工作流视图（编排运行入口的 flow 形态）。
 * 字段来源逐项对应 ServiceState：图结构与元参数按值转发，运行字段（status/port/
 * apiKeyHash 等）不属于工作流视图，故不透传。
 */
export function serviceToWorkflowView(service: ServiceState): WorkflowDocument {
  return {
    id: service.id,
    sessionId: service.sessionId,
    mode: 'mode2',
    name: service.name,
    description: service.description,
    nodes: service.nodes,
    lines: service.lines,
    startNewSession: service.startNewSession,
    workspacePath: service.workspacePath,
    revision: service.revision,
    // 元参数（实例层，可选）：模式二运行时同样按「有效元参数」组装指令与冻结快照，
    // 漏转发会让服务实例的 meta 在运行期被静默丢弃（P0-3 数据链路）。
    ...(service.meta ? { meta: service.meta } : {}),
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  }
}
