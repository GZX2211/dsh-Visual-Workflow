// src/host/agent/runner.ts
//
// 节点子代理执行引擎（T-022）：ensureNodeChild / 配置签名复用 / 工具白名单解析 /
// startNodeTask / interruptChild / 软截停消费。
//
// 官方 seam 取证：
// - startContinuable({ provider, label, request:{prompt,parent,persona?,toolFilter?,agentOptions?}, signal }) → {childId,messageId}；request.prompt 为首条 user 消息，创建即推理；首次必须注入完整任务块，否则子代理空转。
// - interrupt(childId,{kind:'user',parentSessionId}) 尽力中断。
// - 每子代理作用域贡献：官方无 registerContinuableSetup，改为 agent/created 事件（0.1.7 前名为 agent/session-start）在创建窗口按 agent.ctx 安装四类贡献（可见性/软截停/模型选择/角色提示词），与 installModelSelection(agentCtx,…) 范式一致。
//
// 白名单规则：
// - combo：combo.tools ∩ 可见工具集（父代理）+ 所选 MCP 前缀工具；
// - 官方 preset：按服务能力读取 standing scope → 工具名（无法解析则拒绝启动）；
// - 无强制追加：wf_ask/wf_ask_agent 仅组合勾选时进 allow（旧自动追加删除，PRD §4.4.2 规则 7）；
// - wf_db_query 仅存在 db-in 连线时追加（§4.4.3 规则 5）；
// - CHILD_AGENT_HIDDEN_TOOLS（wf_run_node/wf_run_node_wait/wf_finish + 自主编排两工具）永不进 allow，且 tools.restrict 显式 deny（双保险）。

import { readFile } from 'node:fs/promises'
import { dbInEdges, parseExecutionContract } from '../graph/index.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { GraphNode, RoleNode } from '../shared/graph-model.js'
import type { InputAttachmentRef } from "../shared/runtime-types.js"
import type { NodeRunner, NodeStartInput, OrchestratorLogger, GroupStartInput, GroupStartResult } from '../orchestrator/index.js'
import { consumeReactCappedOf, type ReactGuardBridge } from './guards.js'
import { CHILD_AGENT_HIDDEN_TOOLS, RESERVED_TRANSPORT_TOOL, TEAM_TOOL_NAMES } from '../shared/protocol.js'
import type { ModelSelectionLike, ModelSelectionSetup, SelectionChildContext } from './model-selection.js'
import type { ChildPromptSetup, ChildPromptState } from './prompt-setup.js'
import { ChildToolPermissionError, installChildToolPolicy, type ChildToolFilterSetup } from './child-tool-filter.js'
import type { AgentTeamsServiceLike } from '../team/index.js'
import { TeamGroupRunner } from './group-runner.js'

// ---------------------------------------------------------------------------
// 纯函数（签名/复用键/provider 选择）
// ---------------------------------------------------------------------------

/** 子代理复用键：sessionId + flowId + nodeId（跨会话同 id 工作流各自独立）。 */
export function childKey(sessionId: string, flowId: string, nodeId: string): string {
  return `${sessionId}:${flowId}:${nodeId}`
}

/**
 * 影响子代理组成的配置签名（变化即重建；工具为解析后的清单）。
 * 字段依据架构文档 §4.2 L218：rolePrompt/provider/model/工具清单/reasoning
 * （另含 presetId——其决定工具清单，签名内显式保留以抵御同名清单歧义；
 * injectSystemPrompt 决定官方系统提示词开关；injectToolSections 决定工具散文段开关；
 * rolePrompt 为角色 Prompt 的实际注入文本——当 .md 文件路径设置时为其当前内容，文件改动即重建）。
 */
export function nodeChildSignature(node: GraphNode, resolvedTools: string[], rolePrompt: string, injectSystemPrompt = true, injectToolSections = true, collabPrompt = ''): string {
  const data = node.kind === 'parent' || node.kind === 'agent' ? node.data : undefined
  return JSON.stringify({
    rolePrompt: String(rolePrompt ?? ''),
    provider: String(data?.provider ?? ''),
    model: String(data?.model ?? ''),
    reasoning: String(data?.reasoning ?? ''),
    presetId: String(data?.presetId ?? ''),
    tools: [...resolvedTools].sort(),
    injectSystemPrompt: injectSystemPrompt !== false,
    injectToolSections: injectToolSections !== false,
    // 协作 Prompt 属于组级配置；变化时同样重建子代理，避免旧协作信息残留
    collabPrompt,
  })
}

/**
 * provider 首选序（spawn > codex > claude-code > dsh-sdk > acp > 首个可用）。
 *
 * 为什么要 spawn 优先（用户裁决 + 官方取证）：
 *   - 官方 `dsh-subagent-fork-in-process`：`inheritsParentContext = true`，其
 *     `prepareContinuable()` 返回 `completedTurnPrefix(parent)` —— 把父代理（编排根
 *     Agent）从会话开头到最近一次 `turn/end` 的整段已完成对话作为种子灌进子代理，
 *     导致节点子代理拿到父代理的编排指令、提示词与完整上下文（越权）。
 *   - 官方 `dsh-subagent-spawn-in-process`：`inheritsParentContext = false`，
 *     `prepareContinuable()` 返回 `{}` —— 子代理是全新会话、own system prompt、
 *     zero parent context。这正是「每个节点独立角色 / 独立上下文」工作流所需语义。
 *   - 只有 fork 可用时拒绝启动，避免把父代理的整段历史注入节点。
 */
const PROVIDER_PREFERENCE = ['spawn', 'codex', 'claude-code', 'dsh-sdk', 'acp'] as const

/** 从可用 provider 清单中挑选（首选序优先，否则清单第一个；无可选返回 null）。 */
export function pickProviderName(available: string[]): string | null {
  return PROVIDER_PREFERENCE.find((name) => available.includes(name)) ?? available.find((name) => name !== 'fork') ?? null
}

/**
 * 探测可用延续子代理 provider：0.1.2 SubagentRuntime 移除 rc.2 的 list()，改为按名
 * getProvider(name)（未注册返回 undefined）探测候选顺序；旧宿主回退 list() 清单。
 */
export function detectSubagentProvider(service: SubagentsServiceLike): string | null {
  if (typeof service.getProvider === 'function') {
    return PROVIDER_PREFERENCE.find((name) => service.getProvider!(name) !== undefined) ?? null
  }
  return pickProviderName(service.list?.() ?? [])
}

/** 任务块为空的兜底 prompt（正常路径由 T-021 组装任务块；防御性兜底）。 */
function fallbackPrompt(node: RoleNode): string {
  return [
    '你是 Visual Workflow 工作流中的节点子代理。',
    `节点名称：${node.data.label ?? node.id}`,
    '具体任务将随后续消息派发；请按收到的任务要求执行并汇报结论。',
  ].join('\n')
}

/**
 * 解析节点的角色 Prompt 实际注入文本：
 *   - 设置了 promptFilePath（宿主绝对路径）→ 运行时读取该文件（读取失败回退 node.data.systemPrompt）；
 *   - 未设置 → 直接使用 node.data.systemPrompt（内联文本或 .md 内容快照）。
 * 返回的角色文本会纳入子代理签名：文件改动 → 内容变 → 签名变 → 重建子代理 → 自动重载。
 */
export async function resolveRolePrompt(node: RoleNode): Promise<string> {
  const inline = String(node.data?.systemPrompt ?? '')
  const filePath = String(node.data?.promptFilePath ?? '').trim()
  if (!filePath) return inline
  try {
    const content = await readFile(filePath, 'utf8')
    // 文件存在且可读：以文件内容为准（文件修改后新轮自动生效）
    return content
  } catch {
    // 文件不可读（不存在/权限/沙箱拒绝）：回退内联文本，不阻断节点启动
    return inline
  }
}

// ---------------------------------------------------------------------------
// 服务结构适配（官方服务经 ctx.get 解析，运行时守卫收窄；零官方类型依赖）
// ---------------------------------------------------------------------------

/** agents 服务最小结构（注册表；roots 供工具可见集枚举）。 */
export interface AgentsServiceLike {
  get(id: string): unknown
  roots?(): unknown[]
}

/** 子代理服务最小结构（0.1.5-rc.1 SubagentRuntime 使用面；零官方类型依赖，运行时守卫）。 */
export type SubagentTaskBlock = { type: "text"; text: string } | { type: "file"; attachment: InputAttachmentRef; text?: never }

function taskContent(input: NodeStartInput, initial = false): SubagentTaskBlock[] {
  const blocks: SubagentTaskBlock[] = input.blocks.length || !initial ? [...input.blocks] : [{ type: "text", text: fallbackPrompt(input.node as RoleNode) }]
  for (const { attachmentId, name, bytes } of input.attachments ?? []) blocks.push({ type: "file", attachment: { attachmentId, name, bytes } })
  return blocks
}

export interface SubagentsServiceLike {
  /** 延续子代理 provider 名列表（旧面；新宿主改用 getProvider 按名探测）。 */
  list?(): string[]
  /** 延续子代理创建：首条 prompt 即任务块（request 兼容 persona/toolFilter/agentOptions；signal 为必填）。 */
  startContinuable(spec: {
    provider: string
    label: string
    request: {
      prompt: SubagentTaskBlock[]
      parent: unknown
      persona?: string
      toolFilter?: { allow: string[] }
      agentOptions?: { provider?: string; model?: string }
    }
    signal: AbortSignal
  }): Promise<{ childId: string; messageId?: unknown }>
  /** 相邻 Agent 投递（live 父 Agent → direct child 派发下一回合）；**0.1.5 唯一推荐通道**。 */
  sendMessage?(sender: unknown, targetId: string, content: SubagentTaskBlock[], options: { signal?: AbortSignal }): Promise<unknown>
  /**
   * host 协议投递（distinct child turn，durable host source）；**旧宿主兼容兜底**。
   * 【取证】当前官方公开 `SubagentRuntime`（dsh-subagent/lib/types/index.d.ts）只暴露
   * `startContinuable` / `sendMessage` / `interrupt` / `getProvider` / `list` / `drain*`——
   * `queuePrompt` 仅存在于内部 continuation manager（同包 continuation.d.ts，经符号键方法转发），
   * 故该分支在新宿主上不可达，仅作旧宿主降级路径保留（缺失时 deliverReuse 给出明确错误）。
   */
  queuePrompt?(parent: unknown, childId: string, content: SubagentTaskBlock[], source?: unknown, signal?: AbortSignal): Promise<unknown>
  /** 尽力中断当前回合（同步签名 interrupt(target, authority)；保留会话）。 */
  interrupt?(childId: string, authority: { kind: 'user'; parentSessionId: string }): unknown
  /** provider 按名探测（探测 provider 是否注册；未注册返回 undefined）。 */
  getProvider?(name: string): unknown
}

/** 工具服务最小结构（schemas 视图；restrict 双保险）。 */
interface ToolsServiceLike {
  schemas(scope?: unknown): unknown
  restrict?(filter: { allow?: string[]; deny?: string[] }): () => void
}

/** agentPresets 服务最小结构（官方 preset standing scope 解析）。 */
export interface AgentPresetsServiceLike {
  list(): Promise<unknown[]>
  /** 新接口返回引用租约，读取后必须释放；运行时校验其 key。 */
  acquireScope?(id?: string): Promise<{ key: unknown } & object>
  /** 旧接口直接返回 ScopeKey，不拥有可释放租约。 */
  standingKeyFor?(id?: string): Promise<unknown>
}

type PresetFailureStage = "preset_service_missing" | "preset_api_unsupported" | "preset_scope_acquire_failed" | "preset_scope_key_invalid" | "preset_tool_schema_failed" | "preset_scope_release_failed"
interface PresetDiagnosticContext { runId?: string; nodeId?: string }

function presetErrorReason(error: unknown): string {
  let message: string
  if (error instanceof Error) message = error.message
  else if (typeof error === "string") message = error
  else {
    try {
      message = JSON.stringify(error, (key, value: unknown) => /authorization|api[_-]?key|token|password|secret|credential/i.test(key) ? "[redacted]" : value) ?? String(error)
    } catch { message = "无法序列化原始异常" }
  }
  return message
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/(authorization|api[_-]?key|token|password|secret)["']?\s*[:=]\s*["']?[^\s,;"']+/gi, "$1=[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[redacted]")
    .slice(0, 1000)
}

class PresetScopeError extends ChildToolPermissionError {
  readonly errorType: string
  readonly reason: string
  constructor(readonly presetId: string, readonly presetStage: PresetFailureStage, error: unknown) {
    const reason = presetErrorReason(error)
    super(`工具预设解析失败：${presetId} [${presetStage}] ${reason}`)
    this.name = "PresetScopeError"
    this.errorType = error instanceof Error ? error.name : error === null ? "null" : typeof error
    this.reason = reason
  }
}

/**
 * `Symbol.asyncDispose` 的运行时取值。
 * 为什么经类型断言取值：host program 的 lib 为 es2022（不含 esnext.disposable），
 * 直接书写 `Symbol.asyncDispose` 无法通过类型检查；该协议本身由 Node 运行时提供。
 */
const ASYNC_DISPOSE_SYMBOL: symbol | undefined = (Symbol as unknown as { asyncDispose?: symbol }).asyncDispose

/**
 * 释放 preset standing scope 租约（best-effort；调用方负责只释放一次）。
 * 回收失败记录诊断但不替代读取结果；不能据此改变已经解析的权限。
 */
export async function releasePresetLease(lease: unknown, onFailure?: (error: unknown) => void): Promise<void> {
  if (lease === null || typeof lease !== 'object') return
  try {
    const disposer = ASYNC_DISPOSE_SYMBOL === undefined ? undefined : (lease as Record<symbol, unknown>)[ASYNC_DISPOSE_SYMBOL]
    if (typeof disposer !== "function") throw new TypeError("Preset 租约缺少 Symbol.asyncDispose 释放协议")
    await (disposer as () => unknown).call(lease)
  } catch (error) {
    if (onFailure) onFailure(error)
    else console.warn(JSON.stringify({ stage: "preset_scope_release_failed", reason: presetErrorReason(error) }))
  }
}

/**
 * 按公开能力识别 Preset 服务；缺失返回 null，不兼容的已注册服务明确报错。
 */
export function agentPresetsServiceOf(ctx: { get(name: string): unknown }, presetId = ""): AgentPresetsServiceLike | null {
  const service: unknown = ctx.get("agentPresets")
  if (service === null || service === undefined) return null
  if (
    typeof service === "object"
    && typeof (service as { list?: unknown }).list === "function"
    && (typeof (service as AgentPresetsServiceLike).acquireScope === "function"
      || typeof (service as AgentPresetsServiceLike).standingKeyFor === "function")
  ) {
    return service as AgentPresetsServiceLike
  }
  throw new PresetScopeError(presetId, "preset_api_unsupported", "agentPresets 需要 list 和 acquireScope / standingKeyFor；请检查宿主 Preset 服务接口")
}

/** 使用真实 Preset Scope 完成读取；新版优先且失败不回退，旧版不执行租约释放。 */
export async function withPresetScope<T>(presets: AgentPresetsServiceLike, presetId: string, read: (scopeKey: object) => Promise<T> | T, onReleaseFailure?: (error: unknown) => void): Promise<T> {
  const readKey = async (key: unknown): Promise<T> => {
    // ScopeKey 是对象身份，undefined 会让 schemas 读取全局层，不能作为降级值。
    if (key === null || (typeof key !== "object" && typeof key !== "function")) {
      throw new PresetScopeError(presetId, "preset_scope_key_invalid", `Preset 返回无效 ScopeKey（${key === null ? "null" : typeof key}）`)
    }
    try { return await read(key) } catch (error) {
      throw new PresetScopeError(presetId, "preset_tool_schema_failed", error)
    }
  }
  if (typeof presets.acquireScope === "function") {
    let lease: unknown
    try { lease = await presets.acquireScope(presetId) } catch (error) {
      throw new PresetScopeError(presetId, "preset_scope_acquire_failed", error)
    }
    try {
      if (lease === null || typeof lease !== "object") {
        throw new PresetScopeError(presetId, "preset_scope_key_invalid", "acquireScope 未返回有效租约对象")
      }
      let key: unknown
      try { key = (lease as { key?: unknown }).key } catch (error) {
        throw new PresetScopeError(presetId, "preset_scope_key_invalid", error)
      }
      return await readKey(key)
    } finally {
      await releasePresetLease(lease, (error) => {
        const failure = new PresetScopeError(presetId, "preset_scope_release_failed", error)
        if (onReleaseFailure) onReleaseFailure(failure)
        else console.warn(JSON.stringify({ presetId, stage: failure.presetStage, errorType: failure.errorType, reason: failure.reason }))
      })
    }
  }
  if (typeof presets.standingKeyFor === "function") {
    let key: unknown
    try { key = await presets.standingKeyFor(presetId) } catch (error) {
      throw new PresetScopeError(presetId, "preset_scope_acquire_failed", error)
    }
    return readKey(key)
  }
  throw new PresetScopeError(presetId, "preset_api_unsupported", "agentPresets 缺少 acquireScope / standingKeyFor；无法安全解析工具白名单")
}

/** 工具视图缝（白名单解析依赖；CordisToolsView 为真实实现，单测 fake）。 */
export interface ToolsView {
  /** 全部可见工具名（全局层 ∪ 存活 agent scope ∪ preset standing scope）。 */
  visibleToolNames(sessionId?: string): Promise<string[]>
  /** 官方 preset 工具名；解析失败必须拒绝启动，不扩大授权。 */
  presetToolNames(presetId: string, diagnostic?: PresetDiagnosticContext): Promise<string[] | null>
  /** 当前会话父代理工具视图，仅供枚举；创建权限必须由实际 child scope 裁决。 */
  agentToolNames(sessionId?: string): Promise<string[]>
}

/**
 * 真实工具视图适配：并集 = 全局层 ∪ 每个存活 agent 的 scope 视图 ∪ 每个 agent
 * preset 的 standing scope 视图（旧项目 allToolsSchemas 同构移植）。
 * 历史坑注释（旧项目复盘）：scope key 必须是 agent 对象本身，不是 agent.ctx
 * （Cordis Context）——schemas(scope) 按 scope key 查找，传错必然只能看到全局层。
 */
export class CordisToolsView implements ToolsView {
  constructor(private readonly ctx: { get(name: string): unknown; logger?: { warn(message: string): unknown } }) {}

  private toolsService(): ToolsServiceLike | null {
    const service: unknown = this.ctx.get('tools')
    if (service !== null && typeof service === 'object' && typeof (service as { schemas?: unknown }).schemas === 'function') {
      return service as ToolsServiceLike
    }
    return null
  }

  private agentsService(): AgentsServiceLike | null {
    const service: unknown = this.ctx.get('agents')
    if (service !== null && typeof service === 'object' && typeof (service as { get?: unknown }).get === 'function') {
      return service as AgentsServiceLike
    }
    return null
  }

  private logPresetFailure(error: unknown, presetId: string, diagnostic: PresetDiagnosticContext = {}): void {
    const failure = error instanceof PresetScopeError ? error : new PresetScopeError(presetId, "preset_api_unsupported", error)
    this.ctx.logger?.warn(JSON.stringify({ ...diagnostic, code: failure.code, presetId: failure.presetId, phase: failure.phase, stage: failure.presetStage, errorType: failure.errorType, reason: failure.reason }))
  }

  /** 目录枚举允许跳过单个失败预设；与节点执行共用 Scope 获取和 schema 校验。 */
  async allPresetToolSchemas(): Promise<unknown[]> {
    let items: unknown[]
    try {
      const service = agentPresetsServiceOf(this.ctx)
      if (!service) throw new PresetScopeError("", "preset_service_missing", "agentPresets 服务未注册；请启用宿主 Preset 插件")
      items = await service.list()
      if (!Array.isArray(items)) throw new Error("agentPresets.list() 未返回数组")
    } catch (error) {
      this.logPresetFailure(error, "")
      return []
    }
    const out: unknown[] = []
    for (const item of items) {
      const presetId = String((item as { id?: unknown })?.id ?? "").trim()
      if (!presetId) continue
      try { out.push(...await this.presetToolSchemas(presetId)) } catch {
        // presetToolSchemas 已记录诊断；目录继续枚举其他预设。
      }
    }
    return out
  }

  /** 节点执行与目录使用相同的读取规则；失败携带稳定权限错误码和细分诊断。 */
  async presetToolSchemas(presetId: string, diagnostic: PresetDiagnosticContext = {}): Promise<unknown[]> {
    try {
      const presets = agentPresetsServiceOf(this.ctx, presetId)
      if (!presets) throw new PresetScopeError(presetId, "preset_service_missing", "agentPresets 服务未注册；请启用宿主 Preset 插件")
      const tools = this.toolsService()
      if (!tools) throw new PresetScopeError(presetId, "preset_tool_schema_failed", "tools.schemas 不可用；请启用宿主工具服务")
      return await withPresetScope(presets, presetId, (key) => {
        const schemas = tools.schemas(key)
        if (!Array.isArray(schemas)) throw new TypeError("tools.schemas(scopeKey) 未返回数组")
        return schemas
      }, (error) => this.logPresetFailure(error, presetId, diagnostic))
    } catch (error) {
      const failure = error instanceof PresetScopeError ? error : new PresetScopeError(presetId, "preset_api_unsupported", error)
      this.logPresetFailure(failure, presetId, diagnostic)
      throw failure
    }
  }

  async visibleToolNames(sessionId?: string): Promise<string[]> {
    const tools = this.toolsService()
    const out = new Set<string>()
    if (tools) {
      const collect = (scope?: unknown): void => {
        const raw = scope === undefined ? tools.schemas() : tools.schemas(scope)
        const list: unknown[] = Array.isArray(raw) ? raw : []
        for (const schema of list) {
          const name = String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? '')
          if (name) out.add(name)
        }
      }
      collect(undefined) // 全局层视图
      // 存活 agent 的 scope 视图（agent 对象即 scope key）
      const agents = this.agentsService()
      if (agents) {
        const candidates = new Set<unknown>()
        try {
          for (const root of agents.roots?.() ?? []) {
            if (root && String((root as { id?: unknown })?.id ?? '')) candidates.add(root)
          }
        } catch {
          // roots 不可用
        }
        if (sessionId) {
          try {
            const agent = agents.get(sessionId)
            if (agent) candidates.add(agent)
          } catch {
            // 会话 agent 不可用
          }
        }
        for (const agent of candidates) collect(agent)
      }
      for (const schema of await this.allPresetToolSchemas()) {
        const name = String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? "")
        if (name) out.add(name)
      }
    }
    return [...out]
  }

  async presetToolNames(presetId: string, diagnostic?: PresetDiagnosticContext): Promise<string[]> {
    return (await this.presetToolSchemas(presetId, diagnostic))
      .map((schema) => String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? ""))
      .filter(Boolean)
  }

  async agentToolNames(sessionId?: string): Promise<string[]> {
    const tools = this.toolsService()
    if (!tools) return []
    // 优先取当前会话父代理（root agent）scope 视图：全局层 ∪ 父代理链注册工具。
    // scope key 必须是 agent 对象本身（官方 ScopeKey 语义，历史坑见类注释）。
    const agents = this.agentsService()
    let scope: unknown
    if (agents && sessionId) {
      try {
        const agent = agents.get(sessionId)
        if (agent) scope = agent
      } catch {
        // 会话 agent 不可用 → 回退全局层
      }
    }
    const list = (scope === undefined ? tools.schemas() : tools.schemas(scope)) ?? []
    return (Array.isArray(list) ? list : [])
      .map((schema) => String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? ''))
      .filter(Boolean)
  }
}

// ---------------------------------------------------------------------------
// 白名单解析（resolveAgentTools）
// ---------------------------------------------------------------------------

/** 白名单解析入参。 */
export interface ResolveToolsInput {
  store: FlowStore
  toolsView: ToolsView
  sessionId: string
  flowId: string
  runId?: string
  /** 已解析为主节点的角色节点（虚拟节点在 T-021 已解析）。 */
  node: RoleNode
  /**
   * 运行模式（缺省按模式一处理，向后兼容）。模式二的服务文档存储在
   * services/ 目录、须经 getServiceAsFlow 读取——db-in 连线检测必须按
   * 模式分派，否则模式二下 getWorkflow 恒返回 null 导致 wf_db_query 永不注入。
   */
  mode?: 'mode1' | 'mode2'
  /**
   * 被全局关闭的工具名集合（tool-switches 模块的当前快照）。
   * 关闭工具 = 父代理上下文不可见 → 子代理不得携带（双保险第二层，
   * 第一层为 system-prompt/assemble 全局瀑布剔除）。
   */
  disabledTools?: ReadonlySet<string>
}

/**
 * 子代理永久隐藏工具：统一取自共享协议常量 CHILD_AGENT_HIDDEN_TOOLS
 * （wf_run_node / wf_run_node_wait / wf_finish + 自主编排两工具 wf_org_catalog /
 * wf_graph_patch），与 childVisibilityContribution 的 tools.restrict deny 同源。
 *
 * 历史 BUG（2026.09 修复）：本文件曾内联三工具数组，新增自主编排工具时漏改，
 * 导致「架构文档 §4.5 声明子代理永久隐藏」与实现不一致——组合勾选后子代理会拿到
 * 一个必然抛 WF_NOT_ROOT 的工具（或被全局开关静默剔除），用户看到的是「我勾了但
 * 对方没收到」。改为引用协议常量，杜绝再次漏改。
 */
const CHILD_BLOCKED_TOOLS: readonly string[] = CHILD_AGENT_HIDDEN_TOOLS

/**
 * 官方 Team 工具名（永不进入 allow 名单）。
 *
 * 运行事实：官方包把这 9 个工具注册在成员**自身作用域层**，而 `tools.restrict` 的 allow/deny
 * 只针对「可限制的全局工具名」校验并只过滤继承面——名字一旦进入名单，创建子代理时官方校验
 * 会以「unknown global tool」抛错；反过来它们也无需进入名单：自身层注册不受 restrict 影响，
 * 成员天然可见。因此本清单只用于**剔除**，不用于放行。
 */
const TEAM_BLOCKED_ALLOW_TOOLS: readonly string[] = TEAM_TOOL_NAMES

/**
 * 运行时解析节点工具白名单（架构文档 §4.2 L219）：
 *   - presetId 空 → []（无工具）；
 *   - combo- 前缀 → 组合勾选 ∩ 可见工具集 + 所选 MCP 服务器前缀工具（缺失组合报错）；
 *   - 官方 preset → standing scope 工具名（无法解析时拒绝启动）；
 *   - db-in 连线存在 → 追加 wf_db_query（§4.4.3 规则 5）；
 *   - CHILD_AGENT_HIDDEN_TOOLS 无条件剔除（即便被组合勾选也不进入子代理）。
 * 注意：无强制追加——wf_ask/wf_ask_agent 仅在组合勾选时进入（PRD §4.4.2 规则 7）。
 */
export async function resolveAgentTools(input: ResolveToolsInput): Promise<string[]> {
  const presetId = String(input.node.data?.presetId ?? '').trim()
  let allow: string[]
  if (!presetId) {
    allow = []
  } else if (presetId.startsWith('combo-')) {
    const visible = await input.toolsView.visibleToolNames(input.sessionId)
    const combos = await input.store.listToolCombos().catch(() => [])
    const combo = combos.find((item) => item.id === presetId)
    if (!combo) throw new Error(`工具组合不存在：${presetId}（请重新选择模式）`)
    allow = (combo.tools ?? []).filter((name) => visible.includes(name))
    // 所选 MCP 服务器提供的工具全部加入（mcp__<server>__* 前缀）
    for (const serverName of combo.mcpServers ?? []) {
      const prefix = `mcp__${serverName}__`
      for (const name of visible) {
        if (name.startsWith(prefix)) allow.push(name)
      }
    }
    allow = [...new Set(allow)]
  } else {
    const presetNames = await input.toolsView.presetToolNames(presetId, { runId: input.runId, nodeId: input.node.id })
    if (presetNames === null) throw new ChildToolPermissionError(`无法解析工具预设：${presetId}（请确认宿主支持该预设，或选择现有工具组合）`)
    allow = presetNames
  }
  // CHILD_AGENT_HIDDEN_TOOLS（wf_run_node/wf_run_node_wait/wf_finish + 自主编排两工具）
  // 永不可见（§4.4.2 规则 7 双保险第一层）；
  // 官方保留传输名 run_code 也必须剔除：它由官方自动注入子代理 scope（无需勾选），
  // 且进 allow 名单会让官方 tools.restrict 抛错（core/tools L1085 保留名校验）
  allow = allow.filter((name) => !CHILD_BLOCKED_TOOLS.includes(name) && name !== RESERVED_TRANSPORT_TOOL && !TEAM_BLOCKED_ALLOW_TOOLS.includes(name))
  // 权限合法性由创建窗口中的实际 child scope 裁决，父 scope 只用于 UI 枚举。
  // db-in 连线 → wf_db_query 可选注入（§4.4.3 规则 5：有连线才进入工具集）
  if (await hasDbInLine(input)) {
    if (!allow.includes('wf_db_query')) allow.push('wf_db_query')
  }
  // 全局关闭的工具一律剔除（父代理不可见 → 子代理不得携带；配合 UI 置灰禁勾选）
  if (input.disabledTools && input.disabledTools.size > 0) {
    allow = allow.filter((name) => !input.disabledTools!.has(name))
  }
  const execution = parseExecutionContract(input.node.data.execution)
  if (execution.issue) throw new ChildToolPermissionError(execution.issue)
  const missing = (execution.value?.requiredTools ?? []).filter((name) => !allow.includes(name))
  if (missing.length) throw new ChildToolPermissionError(`节点缺少执行契约要求的工具：${missing.join(', ')}（请选择可用预设或工具组合）`)
  return allow
}

/** 该节点是否存在 db-in 连线（运行中读最新流程，双向同步①；读失败按无连线处理）。 */
async function hasDbInLine(input: ResolveToolsInput): Promise<boolean> {
  try {
    // 模式二的服务文档在 services/ 目录，getWorkflow 读 workflows/ 恒为 null——
    // 必须按 mode 分派（与 runtime.currentResolvedFlow 的 Bug 20 修复同源），
    // 否则模式二下数据库连线检测失效、wf_db_query 永不注入（需求 §4.4.3 规则 5）。
    const flow = input.mode === 'mode2'
      ? await input.store.getServiceAsFlow(input.flowId)
      : await input.store.getWorkflow(input.sessionId, input.flowId)
    if (!flow) return false
    return dbInEdges(flow, input.node.id).length > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// NodeAgentRunner（NodeRunner 真实实现）
// ---------------------------------------------------------------------------

/** runner 依赖（官方服务以惰性函数注入，缺省时报明确错误）。 */
export interface NodeAgentRunnerDeps {
  store: FlowStore
  /** agents 服务惰性解析（调用时求值）。 */
  agents: () => AgentsServiceLike | null
  /** subagents 服务惰性解析（调用时求值）。 */
  subagents: () => SubagentsServiceLike | null
  /**
   * 官方 Agent Team 服务惰性解析（协作组路径用）。
   * 返回 null 表示官方团队未挂载：协作组回退到逐节点启动的既有路径。
   */
  teams: () => AgentTeamsServiceLike | null
  /** 工具视图（白名单解析）。 */
  toolsView: ToolsView
  /** 子代理工具白名单装配（协作组成员的创建窗口内安装；节点路径由官方创建请求携带）。 */
  toolFilter: ChildToolFilterSetup
  /** 软截停护栏桥（guards.ts）。 */
  react: ReactGuardBridge
  /** 模型选择装配（model-selection.ts）。 */
  modelSelection: ModelSelectionSetup
  /** 子代理系统提示词注入装配（prompt-setup.ts）。 */
  promptSetup: ChildPromptSetup
  /**
   * 全局关闭工具集快照（tool-switches 模块；缺省空集 = 不做过滤）。
   * host 注入的实现在取值前先做跨进程刷新（ensureFresh），因此允许返回 Promise；
   * 旧实现（同步返回）仍兼容——调用点统一 await。
   */
  toolSwitches?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>
  logger?: OrchestratorLogger
  /** 已替换 child 的作用域撤销由宿主执行；普通结束不调用。 */
  retireChild?: (childId: string) => void
}

/**
 * 节点子代理执行引擎：每个角色节点 = 一个可延续子代理
 * （ctx.subagents.startContinuable，带持久 Session）。
 *   - 复用键 sessionId:flowId:nodeId；配置签名变化时重建（旧子代理保留历史）；
 *   - 首条创建即把完整任务块作为 prompt 注入（杜绝创建即空转）；
 *   - 复用经相邻 Agent 通道派发本轮任务，立即返回（不阻塞父代理）。
 */
export class NodeAgentRunner implements NodeRunner {
  /** 子代理表：复用键 → { childId, signature }。 */
  private readonly nodeChildren = new Map<string, { childId: string; signature: string }>()
  /** 已创建 childId 集合（dispose 清理护栏登记用）。 */
  private readonly childIds = new Set<string>()
  /** 只覆盖创建/投递窗口，同节点并发调用拒绝而不排队重复投递。 */
  private readonly dispatching = new Set<string>()
  /** 软截停消费适配（NodeRunner 契约）。 */
  readonly consumeReactCapped: NonNullable<NodeRunner['consumeReactCapped']>
  /** 协作组启动器（官方 Team 路径；与节点路径共用同一套依赖与装配对象）。 */
  private readonly groups: TeamGroupRunner

  constructor(private readonly deps: NodeAgentRunnerDeps) {
    this.consumeReactCapped = consumeReactCappedOf(deps.react)
    this.groups = new TeamGroupRunner({
      store: deps.store,
      agents: deps.agents,
      subagents: deps.subagents,
      teams: deps.teams,
      toolsView: deps.toolsView,
      ...(deps.toolSwitches ? { toolSwitches: deps.toolSwitches } : {}),
      react: deps.react,
      modelSelection: deps.modelSelection,
      toolFilter: deps.toolFilter,
      promptSetup: deps.promptSetup,
      ...(deps.logger ? { logger: deps.logger } : {}),
      // 纯函数注入：与节点路径同源，杜绝成员与节点两套白名单/提示词口径
      resolveTools: resolveAgentTools,
      resolveRolePrompt,
      detectProvider: detectSubagentProvider,
      signatureOf: (node, resolvedTools, rolePrompt, injectSystemPrompt, injectToolSections, collabPrompt) =>
        nodeChildSignature(node, resolvedTools, rolePrompt, injectSystemPrompt, injectToolSections, collabPrompt),
    })
  }

  // ---- NodeRunner 协作组契约 -------------------------------------------------

  /** 官方 Agent Team 路径是否可用（协作块文案与执行路径选择的判据）。 */
  teamAvailable(sessionId: string): boolean {
    return this.groups.available(sessionId)
  }

  /** 把整个协作组启动为官方 Agent Team（不可用时返回 null，由编排器回退）。 */
  async startGroupTask(input: GroupStartInput): Promise<GroupStartResult | null> {
    return this.groups.start(input)
  }

  // ---- NodeRunner 契约 -------------------------------------------------------

  /**
   * 异步启动一个节点任务（消息驱动，立即返回）：
   *   - 首次创建：任务块已在首条 prompt 注入，子代理立即开始执行；
   *   - 复用：经相邻 Agent 通道派发本轮任务；
   *   - 配置签名变化：重建子代理并尽力中断旧子代理（见 ensureNodeChild）；
   *   - 完成事件由编排器监听 subagent/end 更新快照，本方法不等待执行结果。
   */
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean; replacedChildId?: string }> {
    return this.withNodeDispatch(input, async () => {
      let result = await this.ensureNodeChildUnlocked(input)
      let { childId, created } = result
      // 每轮派发前刷新护栏上限与模型选择（节点级参数可按次覆盖；官方 selection 可变态）。
      // 【时序】setLimit 必须位于任何 await 之前：子代理本轮第一步推理的 pre-step 事件
      // 一旦触发就读 limits 表——若先派发再登记，新回合（可能换了 limit）的第一步
      // 会读到旧上限/未登记值，软截停延迟生效（guards.ts 对 unknown childId 直接放行）。
      this.deps.react.setLimit(childId, input.iterationLimit)
      const subagents = this.requireSubagents()
      const parent = this.requireParent(input.sessionId)
      if (!created) {
        // 复用子代理：相邻投递派发本轮任务（0.1.5-rc.1：sendMessage 优先，queuePrompt 兜底）
        this.assertActive(input)
        try {
          await this.deliverReuse(subagents, parent, childId, taskContent(input), input.signal)
        } catch (error) {
          if (error instanceof Error) Object.assign(error, { childId })
          // 官方 0.1.6 的 SubagentError/NOT_RESUMABLE 发生于 materialize，早于 inbox 接纳。
          // queuePrompt 不具有这个公开保证；未知类型/错误码/已接纳后失败均不重建。
          if (typeof subagents.sendMessage !== "function" || !(error instanceof Error)
            || error.name !== "SubagentError" || !("code" in error) || error.code !== "NOT_RESUMABLE"
            || ("accepted" in error && error.accepted !== false)) throw error
          this.deps.logger?.warn(JSON.stringify({ runId: input.runId, nodeId: input.node.id, childId, attempt: input.attempt,
            phase: "child_resume", errorCode: error.code, reason: presetErrorReason(error),
            cause: error.cause === undefined ? undefined : presetErrorReason(error.cause), accepted: false }))
          this.assertActive(input)
          try {
            // 单次重建，无循环；公共创建路径重新安装权限/提示词并提交最新 blocks。
            result = await this.ensureNodeChildUnlocked(input, true)
          } catch (creationError) {
            this.deps.logger?.warn(JSON.stringify({ runId: input.runId, nodeId: input.node.id, childId, attempt: input.attempt,
              phase: "child_rebuild", status: "fail", resumeCode: error.code, reason: presetErrorReason(creationError) }))
            // 保留创建失败的稳定 code/cause，并另存原始投递异常供诊断。
            if (creationError instanceof Error) Object.assign(creationError, { resumeError: error, childId })
            throw creationError
          }
          childId = result.childId
          created = result.created
        }
      }
      this.attachModelSelection(childId, input)
      await this.attachPromptState(childId, input)
      return result
    })
  }

  /** 尽力中断子代理当前回合（保留会话；官方 interrupt 语义）。 */
  async interruptChild(childId: string, sessionId: string): Promise<void> {
    const subagents = this.requireSubagents()
    try {
      // 0.1.2 interrupt 为同步签名 interrupt(target, authority)；rc.2 同形。await 兼容 Promise 形态。
      const outcome = subagents.interrupt?.(childId, { kind: 'user', parentSessionId: sessionId })
      if (outcome !== undefined && typeof (outcome as Promise<unknown>).then === 'function') {
        await (outcome as Promise<unknown>)
      }
    } catch {
      // 已停止/不存在视为成功（旧项目语义）
    }
  }

  /** 宿主确认旧 Agent 已销毁后回收登记；存活期间保留护栏。 */
  releaseRetiredChild(childId: string): void {
    if (!this.childIds.delete(childId)) return
    this.deps.react.drop(childId)
  }

  /** 清理子代理表与护栏登记（宿主 dispose 调用；不中断**存活**子代理——由运行时统一中止）。
   *  （例外：配置签名变化重建时被替换的旧子代理立即尽力中断，见 ensureNodeChild。）
   *  每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）由 host 层
   *  `agent/created` 处理器在创建窗口内安装，其撤销函数归 host 的
   *  `childScopeDisposers` 管理（见 visual-workflow-host.ts），runner 不再持有。 */
  dispose(): void {
    for (const childId of this.childIds) {
      this.deps.react.drop(childId)
    }
    this.childIds.clear()
    this.nodeChildren.clear()
  }

  /**
   * 复用子代理的下一回合派发：0.1.2 起 SubagentRuntime 已移除 rc.2 的 followup，改为相邻
   * Agent 通道。优先 sendMessage（免自定义 source：sender 即 live 父代理，来源由服务派生）；
   * 次选 queuePrompt（host distinct turn，**旧宿主兼容路径**：当前官方公开 runtime 已无该通道，
   * 见 SubagentsServiceLike.queuePrompt 取证；其 source/signal 为必填，故仅作兜底）。
   *
   * 【0.1.5-rc.1 取证】官方 SubagentRuntime **没有** followup 方法
   * （dsh-subagent/lib/types/index.d.ts：startContinuable/sendMessage/interrupt/
   * drainContinuableDescendants/drainContinuableChildren/listChildren/listDescendants/
   * prompt/interruptByParent/registerProvider/getProvider/list/start），故不再设 followup 回退。
   */
  private async deliverReuse(
    subagents: SubagentsServiceLike,
    parent: unknown,
    childId: string,
    content: SubagentTaskBlock[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (typeof subagents.sendMessage === 'function') {
      await subagents.sendMessage(parent, childId, content, { ...(signal ? { signal } : {}) })
      return
    }
    if (typeof subagents.queuePrompt === 'function') {
      await subagents.queuePrompt(parent, childId, content, undefined, signal)
      return
    }
    throw new Error('subagents 服务不支持复用派发（缺少 sendMessage/queuePrompt）')
  }

  // ---- 子代理创建/复用 ---------------------------------------------------------

  /**
   * 确保节点子代理存在且配置匹配；返回 { childId, created, replacedChildId }。
   * 【关键时序】startContinuable 把 request.prompt 作为第一条 user 消息立即提交，
   * 子代理创建即开始第一轮推理——首次创建必须把完整任务块 blocks 作为 prompt 注入。
   *
   * 签名变化 = 重建：新 child 创建成功后**尽力中断旧 child**并把旧 childId 经
   * replacedChildId 上报编排器（见 NodeRunner.startNodeTask 契约）。
   * 为什么必须中断（2026.10 修复）：旧 child 若继续运行，其 subagent/end 会经编排
   * childIndex 回写**同一个节点**——旧配置的产出/结论覆写新子代理正在推进的状态，
   * 表现为「节点状态错位、输出张冠李戴」。中断是尽力而为（官方 interrupt 语义），
   * 因此编排器侧另有「旧 child 退役」兜底：即便中断未生效，其迟到事件也不再回写。
   * 时序：中断放在新 child 登记之后（登记先于中断，保证编排器先拿到 replaced 通知）。
   */
  async ensureNodeChild(input: NodeStartInput): Promise<{ childId: string; created: boolean; replacedChildId?: string }> {
    return this.withNodeDispatch(input, () => this.ensureNodeChildUnlocked(input))
  }

  private async withNodeDispatch<T>(input: NodeStartInput, operation: () => Promise<T>): Promise<T> {
    const key = childKey(input.sessionId, input.flowId, input.node.id)
    if (this.dispatching.has(key)) throw Object.assign(new Error("该节点正在创建或投递任务"), { code: "WF_BUSY" })
    this.dispatching.add(key)
    try { this.assertActive(input); return await operation() } finally { this.dispatching.delete(key) }
  }

  private assertActive(input: NodeStartInput): void {
    if (input.signal.aborted) throw Object.assign(new Error("节点派发已取消"), { code: "CANCELLED" })
    input.assertActive?.()
  }

  private async ensureNodeChildUnlocked(input: NodeStartInput, recreate = false): Promise<{ childId: string; created: boolean; replacedChildId?: string }> {
    this.requireSubagents()
    this.requireParent(input.sessionId)
    const node = input.node as RoleNode
    const key = childKey(input.sessionId, input.flowId, node.id)

    // 运行时解析工具清单（组合修改即时生效）；白名单 = 勾选 ∩ 可见 + db-in 注入 - 全局关闭
    const tools = await resolveAgentTools({
      store: this.deps.store,
      toolsView: this.deps.toolsView,
      sessionId: input.sessionId,
      flowId: input.flowId,
      runId: input.runId,
      node,
      disabledTools: await this.deps.toolSwitches?.(),
      ...(input.mode ? { mode: input.mode } : {}),
    })
    this.deps.logger?.info(JSON.stringify({ runId: input.runId, nodeId: node.id, attempt: input.attempt, phase: 'tool_policy', status: 'resolved', toolCount: tools.length }))
    const collabPrompt = String(input.collabPrompt ?? '').trim()
    // 角色 Prompt 实际注入文本（.md 路径设置时读取文件当前内容；未设置用内联文本）
    const rolePrompt = await resolveRolePrompt(node)
    const injectSystemPrompt = node.data?.injectSystemPrompt !== false
    const injectToolSections = node.data?.injectToolSections !== false
    const signature = nodeChildSignature(node, tools, rolePrompt, injectSystemPrompt, injectToolSections, collabPrompt)
    const existing = this.nodeChildren.get(key)
    this.assertActive(input)
    if (!recreate && existing && existing.signature === signature) return { childId: existing.childId, created: false }
    return this.createNodeChild(input, tools, signature, { systemPrompt: rolePrompt, injectSystemPrompt, injectToolSections })
  }

  /** 首次、配置变更与不可恢复重建共用创建窗口；成功才切换缓存。 */
  private async createNodeChild(input: NodeStartInput, tools: string[], signature: string, promptState: ChildPromptState): Promise<{ childId: string; created: boolean; replacedChildId?: string }> {
    this.assertActive(input)
    const subagents = this.requireSubagents()
    const parent = this.requireParent(input.sessionId)
    const node = input.node as RoleNode
    const key = childKey(input.sessionId, input.flowId, node.id)

    const provider = detectSubagentProvider(subagents)
    if (!provider) throw Object.assign(new Error("没有可用的隔离子代理 provider；请在 DSH profile 启用 @deepseek-ai/dsh-subagent-spawn-in-process 或安装支持隔离的 provider。fork 会继承父历史，不能用于独立节点"), { code: "WF_ISOLATED_PROVIDER_UNAVAILABLE", phase: "child_start", retryable: false })
    const agentOptions: { provider?: string; model?: string } = {}
    if (node.data?.provider) agentOptions.provider = node.data.provider
    if (node.data?.model) agentOptions.model = node.data.model

    // 【关键时序】每子代理作用域装配（角色提示词/工具可见性/模型选择/软截停）由 host 层
    // `agent/created` 处理器在子代理创建窗口内安装（该事件在 agents.create 发布、
    // 首轮 followup 组装之前串行 await 触发；此时 withPending 的 AsyncLocalStorage 状态仍在作用域内，
    // 各 contribution 能读到本次创建的 promptState/manifest）。因此 startContinuable 只需要
    // 创建子代理并提交首条任务，不再在返回后重复安装——避免二次「工具已更新」。
    const started = await this.deps.toolFilter.withPending(tools, () => this.deps.promptSetup.withPending(promptState, async () => {
      const result = await subagents.startContinuable({
        provider,
        label: node.data.label || `visual-workflow:${input.flowId}:${node.id}`,
        request: {
          // 首条消息 = 完整任务块（任务 + 上下文），杜绝创建即空转；角色 Prompt 由
          // prompt-setup 注册为系统提示词独立段，不再经官方 request.persona 占用官方人设
          prompt: taskContent(input, true),
          parent,
          ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
        },
        signal: input.signal,
      })
      return result
    }))
    try { this.assertActive(input) } catch (error) {
      void this.interruptChild(started.childId, input.sessionId).catch(() => {})
      this.deps.react.drop(started.childId)
      this.deps.retireChild?.(started.childId)
      throw error
    }
    this.deps.toolFilter.remember(started.childId, tools)
    const previous = this.nodeChildren.get(key)
    const replacedChildId = previous && previous.childId !== started.childId ? previous.childId : undefined
    if (replacedChildId) {
      // 配置签名变化重建子代理：旧 child 的作用域装配归 host 的 childScopeDisposers 管理，
      // 由 host 监听 agent/disposed 回收，不再由 runner 撤销。
      this.deps.logger?.debug(`[visual-workflow] 子代理重建：${replacedChildId} -> ${started.childId}`)
    }
    this.nodeChildren.set(key, { childId: started.childId, signature })
    this.childIds.add(started.childId)
    // 创建即开始推理（官方 startContinuable 语义）：软截停上限必须在 startContinuable
    // 返回后的同步块内立即登记（startNodeTask 会再次刷新，幂等）。保证事件循环中任何
    // pre-step 事件（宏任务）晚于登记发生；极端情况下官方在 resolve 前同步触发 pre-step
    // 仍无法覆盖，但该窗口已缩到官方内部实现边界（startNodeTask 复用路径已另行前置）。
    this.deps.react.setLimit(started.childId, input.iterationLimit)
    // 旧 child（被替换者）：登记已切换，旧 child 的软截停标记与护栏一并回收，
    // 再尽力中断其当前回合（保留会话；中断失败不影响新 child 的派发）。
    if (replacedChildId !== undefined) {
      this.deps.retireChild?.(replacedChildId)
      void this.interruptChild(replacedChildId, input.sessionId).catch(() => {
        // 中断是尽力而为（目标不存在/已停止视为成功）；startNodeTask 返回后不再观察
      })
      if (!this.deps.agents()?.get(replacedChildId)) this.releaseRetiredChild(replacedChildId)
    }
    return replacedChildId === undefined
      ? { childId: started.childId, created: true }
      : { childId: started.childId, created: true, replacedChildId }
  }

  // ---- 内部辅助 ---------------------------------------------------------------

  private requireSubagents(): SubagentsServiceLike {
    const subagents = this.deps.subagents()
    if (!subagents) throw new Error('subagents 服务不可用；请确认 Harness 已启用子代理能力')
    return subagents
  }

  private requireParent(sessionId: string): unknown {
    const agents = this.deps.agents()
    if (!agents) throw new Error('Agent 服务不可用；请确认 Harness 已启用子代理能力')
    const parent = agents.get(sessionId)
    if (!parent) throw new Error('当前会话 Agent 未激活；请先回到会话再运行')
    return parent
  }

  /**
   * 把节点级模型选择（provider/model/reasoningEffort）写入该 child 的 selection
   * （经 agent.ctx 身份匹配贡献安装的同一 childCtx，无 pending 竞态）。
   * 官方语义：selection 可变，下一步骤生效——首条请求可能仍用创建时的 agentOptions
   * （reasoning 从第二个步骤起稳定生效，与官方 installModelSelection 一致）。
   */
  private attachModelSelection(childId: string, input: NodeStartInput): void {
    const node = input.node as RoleNode
    const agents = this.deps.agents()
    const agent = agents?.get(childId) as { ctx?: unknown } | null | undefined
    if (!agent || typeof agent !== 'object' || !agent.ctx) return
    const selection: ModelSelectionLike = {
      provider: String(node.data?.provider ?? ''),
      model: String(node.data?.model ?? ''),
    }
    const reasoning = input.thinking ?? node.data?.reasoning
    if (typeof reasoning === 'string' && reasoning.trim()) selection.reasoningEffort = reasoning
    try {
      this.deps.modelSelection.attach(agent.ctx as SelectionChildContext, selection)
    } catch (error) {
      this.deps.logger?.warn(`[visual-workflow] model selection attach failed: ${String(error)}`)
    }
  }

  /**
   * 把节点级角色 Prompt、官方系统提示词开关与工具散文段开关写入该 child 的 prompt setup。
   * 角色 Prompt 由 prompt-setup 注册为系统提示词独立段；injectSystemPrompt=false 时
   * 开关过滤瀑布会清空官方段；injectToolSections=false 时移除 tool:* 散文段。
   * Code Mode 协议段（tools:sdk / tools:ptc-only，0.1.5-rc.1 更名前为 tools:code-only）
   * 与工具 Schema 始终保留，不受两开关影响。
   * 角色文本经 resolveRolePrompt 解析（.md 路径设置时读取文件当前内容），与创建期一致。
   */
  private async attachPromptState(childId: string, input: NodeStartInput): Promise<void> {
    const node = input.node as RoleNode
    const agents = this.deps.agents()
    const agent = agents?.get(childId) as { ctx?: unknown } | null | undefined
    if (!agent || typeof agent !== 'object' || !agent.ctx) return
    try {
      const rolePrompt = await resolveRolePrompt(node)
      this.deps.promptSetup.attach(agent.ctx, {
        systemPrompt: rolePrompt,
        injectSystemPrompt: node.data?.injectSystemPrompt !== false,
        injectToolSections: node.data?.injectToolSections !== false,
      })
    } catch (error) {
      this.deps.logger?.warn(`[visual-workflow] prompt setup attach failed: ${String(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 子代理 scope 双保险：CHILD_AGENT_HIDDEN_TOOLS 经 tools.restrict 显式隐藏
// ---------------------------------------------------------------------------

/**
 * 子代理工具可见性贡献：在 child scope 上 `tools.restrict({ deny: CHILD_AGENT_HIDDEN_TOOLS })`——
 * 与白名单 allow（永不包含）构成双保险（架构文档 §4.2 L219 / §4.5 父子可见性表）。
 * 覆盖 wf_run_node / wf_run_node_wait / wf_finish + 自主编排两工具
 * （wf_org_catalog / wf_graph_patch：改图是父代理的组织权限）。
 *
 * 贡献由宿主在子代理创建窗口内安装（官方 0.1.2 起无 registerContinuableSetup；
 * 撤销函数归宿主，见同目录 AGENTS.md § 状态所有权）。
 *
 * restrict 对未注册工具会抛错（官方 core/tools L1091），故此处尽力而为：
 * 全量名单失败时退回「三常驻工具」名单（自主编排工具注册失败也不至于连带丢掉
 * 三常驻工具的 deny），两者都失败即跳过——白名单 allow 仍兜底。
 */
export function childVisibilityContribution(): (childCtx: unknown) => () => void {
  return (childCtx) => installChildToolPolicy(childCtx, undefined)
}
