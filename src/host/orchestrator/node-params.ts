// src/host/orchestrator/node-params.ts
//
// 节点级执行参数解析（纯函数）：单次调用的参数覆盖 > 节点配置 > 配置默认。
// 只做取值解析，不做校验之外的语义决策（取值域仍由子代理引擎负责）。

import type { RunNodeArgs } from './run-entry.js'

/**
 * 节点级参数解析的最小入参形状。
 *
 * 为什么不是 RoleNode：协作组卡片没有这些字段，但组级调用同样需要「参数覆盖 > 组配置
 * （无）> 配置默认」这一口径；用最小形状表达后，角色节点与组卡片共用同一解析函数，
 * 避免为组卡片复制一份取值规则。
 */
export interface NodeParamsInput {
  data?: {
    /** 两类节点共有字段（弱类型检查要求至少一个共同属性；本函数不读它）。 */
    label?: unknown
    retryLimit?: unknown
    reactLimit?: unknown
    reasoning?: unknown
  } | undefined
}

/** 节点级回流重试上限解析：参数覆盖 > 节点配置 > 配置默认。 */
export function effectiveRetryLimitOf(node: NodeParamsInput, args: RunNodeArgs, fallback: number): number {
  const fromArgs = Number(args?.retryLimit)
  if (Number.isFinite(fromArgs) && fromArgs >= 0) return fromArgs
  const fromNode = Number(node.data?.retryLimit)
  if (Number.isFinite(fromNode) && fromNode >= 0) return fromNode
  return fallback
}

/**
 * 节点级 ReAct 迭代上限解析：参数覆盖 > 节点配置（null=不设限）> 配置默认（<1=不设限）。
 */
export function effectiveReactLimitOf(node: NodeParamsInput, args: RunNodeArgs, fallback: number): number | undefined {
  const fromArgs = Number(args?.iterationLimit)
  if (Number.isFinite(fromArgs) && fromArgs >= 1) return fromArgs
  const fromNode = node.data?.reactLimit
  if (fromNode === null) return undefined // 节点显式不设限（V-01）
  const numeric = Number(fromNode)
  if (Number.isFinite(numeric) && numeric >= 1) return numeric
  // 配置默认 0 = 不设限：必须归一为 undefined——0 会被引擎当成「0 轮上限」，第一步即软截停
  return fallback >= 1 ? fallback : undefined
}

/** 节点级思考强度解析：参数覆盖 > 节点配置 reasoning。 */
export function effectiveThinkingOf(node: NodeParamsInput, args: RunNodeArgs): string | undefined {
  const fromArgs = args?.thinking
  if (typeof fromArgs === 'string' && fromArgs.trim()) return fromArgs
  const fromNode = node.data?.reasoning
  return typeof fromNode === 'string' && fromNode.trim() ? fromNode : undefined
}
