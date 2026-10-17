// src/host/tools/infrastructure/register-tool.ts
//
// 工具注册帮手：把「取 tools 服务 → 守卫 → 注册 → 尽力而为 disposer」这段样板
// 收敛成单一实现（此前 11 个 tool.ts 逐字复制，其中两处还漏掉了 disposer 包装）。
//
// 为什么必须单一实现：守卫消息与 disposer 语义是对外可观察行为——复制出来的副本会漂
// （历史状态：wf-graph-patch / wf-org-catalog 直接 `return tools.register(def)`，卸载时
// 底层 disposer 抛错会打断宿主清理链）。
//
// 两步式 API 而非「定义 + 注册」一步式：守卫必须在**构建定义之前**执行（定义构建可能
// 读 host 能力），顺序反过来会把「服务缺失」误报成别处的 TypeError。

import type { ToolDefinitionLike } from './define-tool.js'

/** tools 服务最小缝（官方 ctx.tools.register 的窄化投影）。 */
export interface ToolsRegistryLike {
  register(def: ToolDefinitionLike): () => void
}

/**
 * 取 tools 服务；缺失或形状漂移（register 不是函数）时抛统一错误。
 * 消息带工具名：装配期失败要能立刻定位是哪个工具没装上。
 */
export function requireToolsService(
  ctx: { get(name: string): unknown },
  toolName: string,
): ToolsRegistryLike {
  const tools = ctx.get('tools') as ToolsRegistryLike | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error(`[visual-workflow] tools 服务不可用，无法注册 ${toolName}`)
  }
  return tools
}

/**
 * 注册工具定义并返回 disposer：注销失败尽力而为——工具可能已被外部注销，此时
 * 宿主清理链不应被中断（重复注销是幂等语义的正常分支，不是错误）。
 */
export function registerTool(tools: ToolsRegistryLike, definition: ToolDefinitionLike): () => void {
  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为（工具可能已被外部注销）
    }
  }
}
