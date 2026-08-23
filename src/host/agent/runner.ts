// src/host/agent/runner.ts
//
// 节点子代理执行引擎（T-022）：ensureNodeChild / 配置签名复用 / 工具白名单解析 /
// startNodeTask / interruptChild / 软截停消费。
//
// 语义来源：
//   - 旧项目 VisualWorkflow/lib/agent-runner.js（childKey/signature/ensureNodeChild/
//     startNodeTask 骨架，已完整通读）+ lib/plugin-catalog.js（白名单解析骨架）；
//   - 架构文档 §4.2 L218-219（复用键、签名、白名单规则：无强制追加、wf_db_query
//     仅 db-in 连线注入、wf_run_node/wf_finish 双保险隐藏）；
//   - 需求文档 §4.2.3.2 规则 3（子代理复用）/ §4.4.2 规则 7（工具可见性）。
//
// 官方 seam 取证（§8 索引 #1/#6/#7，零官方运行时依赖 W-05）：
//   - ctx.subagents.startContinuable({ provider, label, request: { prompt, parent,
//     persona?, toolFilter?, agentOptions? }, signal }) → { childId, messageId }；
//     request.prompt 是首条 user 消息，创建即开始推理——首次创建必须把完整任务块
//     作为 prompt 注入，否则子代理以「无任务」状态空转（旧项目关键时序结论）；
//   - ctx.subagents.followup(parent, childId, content, { source, signal })——复用
//     派发；source 记录消息来源（{ kind: 'coordinator', form: 'relay',
//     senderSessionId } 沿用旧项目语义）；
//   - ctx.subagents.interrupt(childId, { kind: 'user', parentSessionId })——尽力中断；
//   - ctx.subagents.registerContinuableSetup((childCtx) => disposer)——贡献注入点。
//
// 白名单规则（架构文档 §4.2 L219，与旧项目行为差异已标注）：
//   - combo：combo.tools ∩ 可见工具集（父代理工具集）+ 所选 MCP 服务器前缀工具；
//   - 官方 preset：经 agentPresets.standingKeyFor 取 standing scope 工具名 ∩ 可见
//     （服务缺失回退全部可见——旧项目兜底语义）；旧项目 minimal/ptc 硬编码正则
//     列表被真实 preset 解析取代（更精确）；
//   - **无强制追加**：wf_ask/wf_ask_agent 仅在组合勾选时进入 allow（旧项目自动
//     追加 wf_ask 的行为删除——PRD §4.4.2 规则 7 定稿）；
//   - wf_db_query 仅在存在 db-in 连线时追加（§4.4.3 规则 5）；
//   - wf_run_node/wf_finish 永不进入 allow，且经 tools.restrict 显式 deny（双保险）。

import type { Context } from '@deepseek-ai/cordis'
import { dbInEdges } from '../graph/model.js'
import type { FlowStore } from '../storage/flow-store.js'
import type { GraphNode, RoleNode } from '../shared/graph-model.js'
import type { NodeRunner, NodeStartInput, OrchestratorLogger } from '../orchestrator/runtime.js'
import { consumeReactCappedOf, type ReactGuardBridge } from './guards.js'
import type { ModelSelectionLike, ModelSelectionSetup, SelectionChildContext } from './model-selection.js'

// ---------------------------------------------------------------------------
// 纯函数（签名/复用键/provider 选择）
// ---------------------------------------------------------------------------

/** 子代理复用键：sessionId + flowId + nodeId（跨会话同 id 工作流各自独立）。 */
export function childKey(sessionId: string, flowId: string, nodeId: string): string {
  return `${sessionId}:${flowId}:${nodeId}`
}

/**
 * 影响子代理组成的配置签名（变化即重建；工具为解析后的清单）。
 * 字段依据架构文档 §4.2 L218：persona/provider/model/工具清单/reasoning
 * （另含 presetId——其决定工具清单，签名内显式保留以抵御同名清单歧义）。
 */
export function nodeChildSignature(node: GraphNode, resolvedTools: string[]): string {
  const data = node.kind === 'parent' || node.kind === 'agent' ? node.data : undefined
  return JSON.stringify({
    persona: String(data?.systemPrompt ?? ''),
    provider: String(data?.provider ?? ''),
    model: String(data?.model ?? ''),
    reasoning: String(data?.reasoning ?? ''),
    presetId: String(data?.presetId ?? ''),
    tools: [...resolvedTools].sort(),
  })
}

/** provider 首选序（旧项目语义：fork > spawn > codex > claude-code > dsh-sdk > acp > 首个可用）。 */
const PROVIDER_PREFERENCE = ['fork', 'spawn', 'codex', 'claude-code', 'dsh-sdk', 'acp'] as const

/** 从可用 provider 清单中挑选（首选序优先，否则清单第一个；无可选返回 null）。 */
export function pickProviderName(available: string[]): string | null {
  return PROVIDER_PREFERENCE.find((name) => available.includes(name)) ?? available[0] ?? null
}

/** 任务块为空的兜底 prompt（正常路径由 T-021 组装任务块；防御性兜底）。 */
function fallbackPrompt(node: RoleNode): string {
  return [
    '你是 Visual Workflow 工作流中的节点子代理。',
    `节点名称：${node.data.label ?? node.id}`,
    '具体任务将随后续消息派发；请按收到的任务要求执行并汇报结论。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 服务结构适配（官方服务经 ctx.get 解析，运行时守卫收窄；零官方类型依赖）
// ---------------------------------------------------------------------------

/** agents 服务最小结构（注册表；roots 供工具可见集枚举）。 */
export interface AgentsServiceLike {
  get(id: string): unknown
  roots?(): unknown[]
}

/** 子代理服务最小结构（官方 SubagentRuntime 使用面）。 */
export interface SubagentsServiceLike {
  list(): string[]
  startContinuable(spec: {
    provider: string
    label: string
    request: {
      prompt: Array<{ type: 'text'; text: string }>
      parent: unknown
      persona?: string
      toolFilter?: { allow: string[] }
      agentOptions?: { provider?: string; model?: string }
    }
    signal: AbortSignal
  }): Promise<{ childId: string; messageId?: unknown }>
  followup(parent: unknown, childId: string, content: unknown[], options: { source: unknown; signal?: AbortSignal }): Promise<unknown>
  interrupt(childId: string, authority: { kind: 'user'; parentSessionId: string }): Promise<void>
  registerContinuableSetup(contribution: (childCtx: unknown) => () => void): () => void
}

/** 工具服务最小结构（schemas 视图；restrict 双保险）。 */
interface ToolsServiceLike {
  schemas(scope?: unknown): unknown
  restrict?(filter: { allow?: string[]; deny?: string[] }): () => void
}

/** agentPresets 服务最小结构（官方 preset standing scope 解析）。 */
interface AgentPresetsServiceLike {
  list(): Promise<unknown[]>
  standingKeyFor(presetId: string): Promise<unknown>
}

/** 工具视图缝（白名单解析依赖；CordisToolsView 为真实实现，单测 fake）。 */
export interface ToolsView {
  /** 全部可见工具名（全局层 ∪ 存活 agent scope ∪ preset standing scope）。 */
  visibleToolNames(sessionId?: string): Promise<string[]>
  /** 官方 preset 的 standing scope 工具名；服务缺失返回 null（调用方回退）。 */
  presetToolNames(presetId: string): Promise<string[] | null>
}

/**
 * 真实工具视图适配：并集 = 全局层 ∪ 每个存活 agent 的 scope 视图 ∪ 每个 agent
 * preset 的 standing scope 视图（旧项目 allToolsSchemas 同构移植）。
 * 历史坑注释（旧项目复盘）：scope key 必须是 agent 对象本身，不是 agent.ctx
 * （Cordis Context）——schemas(scope) 按 scope key 查找，传错必然只能看到全局层。
 */
export class CordisToolsView implements ToolsView {
  constructor(private readonly ctx: Context) {}

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

  private agentPresetsService(): AgentPresetsServiceLike | null {
    const service: unknown = this.ctx.get('agentPresets')
    if (
      service !== null && typeof service === 'object'
      && typeof (service as { list?: unknown }).list === 'function'
      && typeof (service as { standingKeyFor?: unknown }).standingKeyFor === 'function'
    ) {
      return service as AgentPresetsServiceLike
    }
    return null
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
      // agent preset 的 standing scope key（无存活会话时也能列全各 preset 工具）
      const presets = this.agentPresetsService()
      if (presets) {
        try {
          const items = await presets.list()
          for (const item of items ?? []) {
            const pid = String((item as { id?: unknown })?.id ?? '').trim()
            if (!pid) continue
            try {
              const key = await presets.standingKeyFor(pid)
              if (key !== undefined) collect(key)
            } catch {
              // 单个 preset 失败跳过
            }
          }
        } catch {
          // agentPresets 不可用
        }
      }
    }
    return [...out]
  }

  async presetToolNames(presetId: string): Promise<string[] | null> {
    const tools = this.toolsService()
    const presets = this.agentPresetsService()
    if (!tools || !presets) return null
    try {
      const key = await presets.standingKeyFor(presetId)
      if (key === undefined) return null
      const list = (tools.schemas(key) ?? []) as unknown[]
      return (Array.isArray(list) ? list : [])
        .map((schema) => String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? ''))
        .filter(Boolean)
    } catch {
      return null
    }
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
  /** 已解析为主节点的角色节点（虚拟节点在 T-021 已解析）。 */
  node: RoleNode
}

/** 子代理永不可见的两工具（§4.4.2 规则 7）：白名单排除 + tools.restrict 双保险第一层。 */
const CHILD_BLOCKED_TOOLS = ['wf_run_node', 'wf_finish']

/**
 * 运行时解析节点工具白名单（架构文档 §4.2 L219）：
 *   - presetId 空 → []（无工具）；
 *   - combo- 前缀 → 组合勾选 ∩ 可见工具集 + 所选 MCP 服务器前缀工具（缺失组合报错）；
 *   - 官方 preset → standing scope 工具名 ∩ 可见（服务缺失回退全部可见）；
 *   - db-in 连线存在 → 追加 wf_db_query（§4.4.3 规则 5）；
 *   - wf_run_node/wf_finish 无条件剔除（即便被勾选也不进入子代理）。
 * 注意：无强制追加——wf_ask/wf_ask_agent 仅在组合勾选时进入（PRD §4.4.2 规则 7）。
 */
export async function resolveAgentTools(input: ResolveToolsInput): Promise<string[]> {
  const presetId = String(input.node.data?.presetId ?? '').trim()
  const visible = await input.toolsView.visibleToolNames(input.sessionId)
  let allow: string[]
  if (!presetId) {
    allow = []
  } else if (presetId.startsWith('combo-')) {
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
    const presetNames = await input.toolsView.presetToolNames(presetId)
    allow = presetNames ?? visible
  }
  // wf_run_node/wf_finish 永不可见（§4.4.2 规则 7 双保险第一层）
  allow = allow.filter((name) => !CHILD_BLOCKED_TOOLS.includes(name))
  // db-in 连线 → wf_db_query 可选注入（§4.4.3 规则 5：有连线才进入工具集）
  if (await hasDbInLine(input)) {
    if (!allow.includes('wf_db_query')) allow.push('wf_db_query')
  }
  return allow
}

/** 该节点是否存在 db-in 连线（运行中读最新流程，双向同步①；读失败按无连线处理）。 */
async function hasDbInLine(input: ResolveToolsInput): Promise<boolean> {
  try {
    const flow = await input.store.getWorkflow(input.sessionId, input.flowId)
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
  /** 工具视图（白名单解析）。 */
  toolsView: ToolsView
  /** 软截停护栏桥（guards.ts）。 */
  react: ReactGuardBridge
  /** 模型选择装配（model-selection.ts）。 */
  modelSelection: ModelSelectionSetup
  logger?: OrchestratorLogger
}

/**
 * 节点子代理执行引擎：每个角色节点 = 一个可延续子代理
 * （ctx.subagents.startContinuable，带持久 Session）。
 *   - 复用键 sessionId:flowId:nodeId；配置签名变化时重建（旧子代理保留历史）；
 *   - 首条创建即把完整任务块作为 prompt 注入（杜绝创建即空转）；
 *   - 复用经 followup 派发本轮任务，立即返回（不阻塞父代理）。
 */
export class NodeAgentRunner implements NodeRunner {
  /** 子代理表：复用键 → { childId, signature }。 */
  private readonly nodeChildren = new Map<string, { childId: string; signature: string }>()
  /** 已创建 childId 集合（dispose 清理护栏登记用）。 */
  private readonly childIds = new Set<string>()
  /** 软截停消费适配（NodeRunner 契约）。 */
  readonly consumeReactCapped: NonNullable<NodeRunner['consumeReactCapped']>

  constructor(private readonly deps: NodeAgentRunnerDeps) {
    this.consumeReactCapped = consumeReactCappedOf(deps.react)
  }

  // ---- NodeRunner 契约 -------------------------------------------------------

  /**
   * 异步启动一个节点任务（消息驱动，立即返回）：
   *   - 首次创建：任务块已在首条 prompt 注入，子代理立即开始执行；
   *   - 复用：经 followup 派发本轮任务；
   *   - 完成事件由编排器监听 subagent/end 更新快照，本方法不等待执行结果。
   */
  async startNodeTask(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    const { childId, created } = await this.ensureNodeChild(input)
    const subagents = this.requireSubagents()
    const parent = this.requireParent(input.sessionId)
    if (!created) {
      // 复用子代理：followup 派发本轮任务（官方 FIFO 下一回合）
      await subagents.followup(parent, childId, input.blocks, {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: input.sessionId },
        ...(input.signal ? { signal: input.signal } : {}),
      })
    }
    // 每轮派发后刷新护栏上限与模型选择（节点级参数可按次覆盖；官方 selection 可变态）
    this.deps.react.setLimit(childId, input.iterationLimit)
    this.attachModelSelection(childId, input)
    return { childId, created }
  }

  /** 尽力中断子代理当前回合（保留会话；官方 interrupt 语义）。 */
  async interruptChild(childId: string, sessionId: string): Promise<void> {
    const subagents = this.requireSubagents()
    try {
      await subagents.interrupt(childId, { kind: 'user', parentSessionId: sessionId })
    } catch {
      // 已停止/不存在视为成功（旧项目语义）
    }
  }

  /** 清理子代理表与护栏登记（宿主 dispose 调用；不中断子代理——由运行时统一中止）。 */
  dispose(): void {
    for (const childId of this.childIds) {
      this.deps.react.drop(childId)
    }
    this.childIds.clear()
    this.nodeChildren.clear()
  }

  // ---- 子代理创建/复用 ---------------------------------------------------------

  /**
   * 确保节点子代理存在且配置匹配；返回 { childId, created }。
   * 【关键时序】startContinuable 把 request.prompt 作为第一条 user 消息立即提交，
   * 子代理创建即开始第一轮推理——首次创建必须把完整任务块 blocks 作为 prompt 注入。
   */
  async ensureNodeChild(input: NodeStartInput): Promise<{ childId: string; created: boolean }> {
    const subagents = this.requireSubagents()
    const parent = this.requireParent(input.sessionId)
    const node = input.node as RoleNode
    const key = childKey(input.sessionId, input.flowId, node.id)

    // 运行时解析工具清单（组合修改即时生效）；白名单 = 勾选 ∩ 可见 + db-in 注入
    const tools = await resolveAgentTools({
      store: this.deps.store,
      toolsView: this.deps.toolsView,
      sessionId: input.sessionId,
      flowId: input.flowId,
      node,
    })
    const signature = nodeChildSignature(node, tools)
    const existing = this.nodeChildren.get(key)
    if (existing && existing.signature === signature) return { childId: existing.childId, created: false }

    const provider = pickProviderName(subagents.list())
    if (!provider) throw new Error('没有可用的子代理 provider（预期 fork 或 spawn）')
    const persona = String(node.data?.systemPrompt ?? '').trim()
    // 白名单为空 → 不传 toolFilter（子代理继承父代理工具集边界由宿主组合决定）；
    // wf_run_node/wf_finish 永不进入 allow（§4.4.2 规则 7）
    const toolFilter = tools.length > 0 ? { allow: [...tools] } : undefined
    const agentOptions: { provider?: string; model?: string } = {}
    if (node.data?.provider) agentOptions.provider = node.data.provider
    if (node.data?.model) agentOptions.model = node.data.model

    const started = await subagents.startContinuable({
      provider,
      label: `visual-workflow:${input.flowId}:${node.id}`,
      request: {
        // 首条消息 = 完整任务块（任务 + 上下文），杜绝创建即空转
        prompt: input.blocks.length > 0 ? input.blocks : [{ type: 'text', text: fallbackPrompt(node) }],
        parent,
        ...(persona ? { persona } : {}),
        ...(toolFilter ? { toolFilter } : {}),
        ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
      },
      signal: input.signal,
    })
    this.nodeChildren.set(key, { childId: started.childId, signature })
    this.childIds.add(started.childId)
    return { childId: started.childId, created: true }
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
}

// ---------------------------------------------------------------------------
// 子代理 scope 双保险：wf_run_node / wf_finish 经 tools.restrict 显式隐藏
// ---------------------------------------------------------------------------

/**
 * 子代理工具可见性贡献（经 registerContinuableSetup 注入）：
 * 在 child scope 上 tools.restrict({ deny: ['wf_run_node', 'wf_finish'] })——
 * 与白名单 allow（永不包含）构成双保险（架构文档 §4.2 L219）。restrict 对未注册
 * 工具会抛错（官方 core/tools L1091），故此处尽力而为：失败即跳过，白名单仍兜底。
 */
export function childVisibilityContribution(): (childCtx: unknown) => () => void {
  return (rawChildCtx) => {
    try {
      const childCtx = rawChildCtx as { get?: (name: string) => unknown }
      if (typeof childCtx.get !== 'function') return () => {}
      const tools = childCtx.get('tools') as ToolsServiceLike | null | undefined
      if (tools && typeof tools.restrict === 'function') {
        return tools.restrict({ deny: ['wf_run_node', 'wf_finish'] })
      }
    } catch {
      // 工具尚未注册或服务缺失：白名单 allow 已排除，双保险尽力而为
    }
    return () => {}
  }
}
