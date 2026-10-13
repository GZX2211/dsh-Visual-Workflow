// src/host/agent/group-runner.ts
//
// 协作组启动器：把一个协作组节点的全部成员交给官方 Agent Team。
//
// 职责边界（与 runner.ts 的节点路径对照）：
//   - 节点路径：一个角色节点 ⇄ 一个可延续子代理，创建参数经官方 startContinuable 携带；
//   - 组路径：一个协作组节点 ⇄ 一批官方 teammate，创建入口是官方 Team 服务
//     `spawnTeammate`，其创建请求**不接受**成员级模型与工具白名单，因此成员级组成
//     （角色提示词 / 模型选择 / 工具白名单）由本模块在子代理创建窗口内装配。
//
// 官方机制事实（决定了本模块的行为）：
//   - 官方成员名在同一团队内永久不可复用、成员不可删除；因此已存在的同名成员只能
//     复用（重新派发任务），再次创建必然失败；
//   - 成员可能处于 failed（创建失败）——该成员既不能复用（官方只解析 active 成员）
//     也不能重建（名字已占用），此时给出可行动的明确错误；
//   - 成员是 Lead 的直接可延续子代理，其每个驻留周期都发 subagent/start 与 subagent/end，
//     故节点状态回写与协作组聚合沿用既有观察链路，无需新通道。
//
// 成员级组成不可变：官方成员在创建时确定组成，签名变化无法重建，只能告警（提示新建会话）。

import type { FlowStore } from '../storage/flow-store.js'
import type { RoleNode } from '../shared/graph-model.js'
import type {
  GroupMemberStarted,
  GroupStartInput,
  GroupStartResult,
  OrchestratorLogger,
} from '../orchestrator/index.js'
import {
  isTeammateNameValid,
  teammateDescriptionOf,
  teammateNameOf,
  type AgentTeamsServiceLike,
} from '../team/index.js'
import type { ChildPromptSetup, ChildPromptState } from './prompt-setup.js'
import type { ChildToolFilterSetup } from './child-tool-filter.js'
import type { ModelSelectionLike, ModelSelectionSetup } from './model-selection.js'
import type { AgentsServiceLike, SubagentsServiceLike, ToolsView } from './runner.js'
import type { ReactGuardBridge } from './guards.js'

/** 成员工具白名单解析入参（与节点路径同源，避免两套口径）。 */
export interface GroupMemberToolsInput {
  store: FlowStore
  toolsView: ToolsView
  sessionId: string
  flowId: string
  node: RoleNode
  disabledTools?: ReadonlySet<string>
  mode?: 'mode1' | 'mode2'
}

/** 协作组启动器依赖（纯函数经注入传入，避免与 runner 形成运行时循环依赖）。 */
export interface TeamGroupRunnerDeps {
  store: FlowStore
  /** agents 服务惰性解析（取会话根 Agent 作为官方团队 Lead）。 */
  agents: () => AgentsServiceLike | null
  /** subagents 服务惰性解析（provider 探测）。 */
  subagents: () => SubagentsServiceLike | null
  /** 官方 Team 服务惰性解析；返回 null 即不可用，调用方回退逐节点路径。 */
  teams: () => AgentTeamsServiceLike | null
  toolsView: ToolsView
  /** 全局关闭工具快照（取值前由宿主保证已跨进程刷新）。 */
  toolSwitches?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>
  react: ReactGuardBridge
  modelSelection: ModelSelectionSetup
  toolFilter: ChildToolFilterSetup
  promptSetup: ChildPromptSetup
  logger?: OrchestratorLogger
  /** 成员工具白名单解析（resolveAgentTools）。 */
  resolveTools: (input: GroupMemberToolsInput) => Promise<string[]>
  /** 角色 Prompt 实际文本解析（resolveRolePrompt）。 */
  resolveRolePrompt: (node: RoleNode) => Promise<string>
  /** 延续子代理 provider 探测（detectSubagentProvider）。 */
  detectProvider: (service: SubagentsServiceLike) => string | null
  /** 子代理组成签名（nodeChildSignature）。 */
  signatureOf: (
    node: RoleNode,
    resolvedTools: string[],
    rolePrompt: string,
    injectSystemPrompt: boolean,
    injectToolSections: boolean,
    collabPrompt: string,
  ) => string
}

/** 协作组启动器（官方 Team 路径；不可用时由调用方回退）。 */
export class TeamGroupRunner {
  /**
   * 官方成员名 → 上次生效的组成签名。
   * 【释放路径】条目与团队成员一一对应（官方成员本身在会话内不可删除），
   * 名称数量有官方上限，随宿主持有的本对象一起回收。
   */
  private readonly memberSignatures = new Map<string, string>()

  constructor(private readonly deps: TeamGroupRunnerDeps) {}

  /**
   * 官方 Team 路径是否可用（协作块文案与执行路径选择的唯一判据）。
   * 条件：官方服务可用 + 会话根 Agent 存活 + 存在可用的延续子代理 provider。
   */
  available(sessionId: string): boolean {
    if (!this.deps.teams()) return false
    if (!this.rootAgentOf(sessionId)) return false
    const subagents = this.deps.subagents()
    return subagents !== null && this.deps.detectProvider(subagents) !== null
  }

  /**
   * 启动整个协作组：逐个成员创建或复用官方 teammate，并派发本轮任务。
   *
   * @returns 成员启动结果；官方 Team 服务或根 Agent 不可用时返回 null（调用方回退）。
   * @throws 成员名已被失败成员占用、无可用 provider、官方未返回成员标识等可行动错误。
   */
  async start(input: GroupStartInput): Promise<GroupStartResult | null> {
    const teams = this.deps.teams()
    if (!teams) return null
    const root = this.rootAgentOf(input.sessionId)
    if (!root) return null
    const subagents = this.deps.subagents()
    if (!subagents) return null
    const provider = this.deps.detectProvider(subagents)
    if (!provider) throw new Error('没有可用的子代理 provider（协作组成员无法创建）')

    const disabledTools = await this.deps.toolSwitches?.()
    // 每个成员的官方身份与组成：
    //   - 名字由节点 id 确定派生（同一节点恒同名 → 复用可命中）；
    //   - 名字在团队内永久占用，故成员清单只需读一次并**按本次新建结果就地补充**，
    //     避免同一组内重复名字被重复创建（官方会拒绝，但失败信息不友好）。
    const roster = new Map(teams.listMembers(root).map((member) => [String(member?.name ?? ''), member]))
    const members: GroupMemberStarted[] = []

    for (const plan of input.members) {
      const node = plan.node
      const name = teammateNameOf(node.id)
      if (!isTeammateNameValid(name)) {
        throw new Error(`协作组成员名不合法：${name}（来自节点 ${node.id}）`)
      }
      const tools = await this.deps.resolveTools({
        store: this.deps.store,
        toolsView: this.deps.toolsView,
        sessionId: input.sessionId,
        flowId: input.flowId,
        node,
        ...(disabledTools ? { disabledTools } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
      })
      const rolePrompt = await this.deps.resolveRolePrompt(node)
      const injectSystemPrompt = node.data?.injectSystemPrompt !== false
      const injectToolSections = node.data?.injectToolSections !== false
      const selection = selectionOf(node, plan.thinking)
      const signature = this.deps.signatureOf(node, tools, rolePrompt, injectSystemPrompt, injectToolSections, input.collabPrompt)

      const existing = roster.get(name)
      if (existing) {
        if (existing.status === 'failed') {
          // 官方成员名不可复用、失败成员不可寻址：无法复用也无法重建，只能换会话或改名
          throw new Error(
            `协作组成员「${name}」此前创建失败且名字已被占用（官方成员名在同一会话内不可复用）。` +
            '请新建会话后重新运行，或修改该成员节点的 id 以生成新名字。',
          )
        }
        if (existing.status === 'provisioning') {
          throw new Error(`协作组成员「${name}」仍在创建中，请稍后重试`)
        }
        const childId = String(existing.id ?? '')
        await teams.sendMessage(root, { target: name, content: plan.blocks, signal: input.signal })
        this.applyMemberComposition(childId, selection, tools, plan.iterationLimit)
        this.reportSignatureChange(name, signature)
        members.push({ nodeId: node.id, target: name, childId, reused: true })
        continue
      }

      const promptState: ChildPromptState = { systemPrompt: rolePrompt, injectSystemPrompt, injectToolSections }
      const spawned = await this.deps.promptSetup.withPending(promptState, () =>
        this.deps.toolFilter.withPending(tools, () =>
          this.deps.modelSelection.withPending(selection, () =>
            teams.spawnTeammate(root, {
              name,
              description: teammateDescriptionOf(node.data?.label, node.id),
              prompt: plan.blocks,
              // 成员是全新角色：不继承 Lead 对话（fork 会把编排指令与上下文灌进成员）
              context: 'fresh',
              provider,
              signal: input.signal,
            }))))
      const childId = String(spawned?.member?.id ?? '')
      if (!childId) throw new Error(`官方 Team 未返回成员标识：${name}`)
      this.applyMemberComposition(childId, selection, tools, plan.iterationLimit)
      this.rememberSignature(name, signature)
      roster.set(name, spawned?.member ?? { id: childId, name, role: 'teammate', status: 'inactive' })
      members.push({ nodeId: node.id, target: name, childId, reused: false })
    }

    return { members }
  }

  /** 会话根 Agent（官方团队 Lead）：不存在即无法启动团队。 */
  private rootAgentOf(sessionId: string): unknown | null {
    const agents = this.deps.agents()
    if (!agents || typeof agents.get !== 'function') return null
    return agents.get(sessionId) ?? null
  }

  /**
   * 应用成员级组成：留存（供重发布重装）并登记本轮护栏上限。
   * 创建路径已在创建窗口内生效；复用路径下模型的后续请求与工具可见性由重发布重装补齐。
   */
  private applyMemberComposition(
    childId: string,
    selection: ModelSelectionLike | undefined,
    tools: readonly string[],
    iterationLimit: number | undefined,
  ): void {
    if (!childId) return
    if (selection) this.deps.modelSelection.remember(childId, selection)
    this.deps.toolFilter.remember(childId, tools)
    // 软截停上限按 child 登记：回合开始读取，故必须在派发返回后的同步块内完成
    this.deps.react.setLimit(childId, iterationLimit)
  }

  /** 记录成员组成签名（首次）。 */
  private rememberSignature(name: string, signature: string): void {
    this.memberSignatures.set(name, signature)
  }

  /**
   * 成员组成签名变化告警（不重建成员）。
   * 官方成员在创建时确定组成，同会话内无法重建；签名变化只能靠新建会话生效，
   * 因此这里只给出可行动诊断，不静默忽略。
   */
  private reportSignatureChange(name: string, signature: string): void {
    const previous = this.memberSignatures.get(name)
    if (previous === undefined) {
      this.memberSignatures.set(name, signature)
      return
    }
    if (previous === signature) return
    this.memberSignatures.set(name, signature)
    this.deps.logger?.warn(
      `[visual-workflow] 协作组成员「${name}」的组成（角色提示词/模型/工具/协作 Prompt）已变化，` +
      '但官方成员在会话内不可重建；本次仍沿用既有组成，新建会话后生效。',
    )
  }
}

/**
 * 成员模型选择：节点配置齐全时按节点路由，否则返回 undefined（沿用官方继承路由）。
 *
 * 为什么不做空串回退：把空 provider/model 写入 selection 会把成员请求路由改写为空值，
 * 而官方默认行为（继承 Lead 路由）才是未配置节点时的正确语义。
 * 为什么思考强度可单独生效：官方 selection 在无 effort 时清除继承值，恢复所选模型默认行为。
 */
function selectionOf(node: RoleNode, thinking: string | undefined): ModelSelectionLike | undefined {
  const provider = String(node.data?.provider ?? '').trim()
  const model = String(node.data?.model ?? '').trim()
  if (!provider || !model) return undefined
  const reasoning = String(thinking ?? node.data?.reasoning ?? '').trim()
  return reasoning ? { provider, model, reasoningEffort: reasoning } : { provider, model }
}
