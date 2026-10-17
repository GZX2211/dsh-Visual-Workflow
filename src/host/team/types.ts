// src/host/team/types.ts
//
// 官方 Agent Team 服务的最小消费面（运行时守卫收窄；零官方类型依赖）。
//
// 只声明插件真正消费的字段：创建 teammate、读取成员清单、向成员投递消息。
// 不声明任务板与等待能力——插件不代替成员使用它们，成员自己持有全部官方工具。
//
// 为什么请求形状如此窄：官方 `TeamService.spawnTeammate` 只接受
// name / description / prompt / context / provider / signal 六个字段，
// 成员级模型、工具白名单与人设**不经过该请求**，由插件在子代理创建窗口内另行装配。

/** 官方 Team 成员行（模型可见名 + 生命周期阶段 + 回合可用状态）。 */
export interface TeamMemberViewLike {
  id: string
  name: string
  role: 'lead' | 'teammate'
  /** running = 有回合在执行；inactive = 当前无回合（含未加载）；provisioning/failed = 创建态。 */
  status: 'running' | 'inactive' | 'provisioning' | 'failed'
  description?: string
  model?: string
}

/**
 * 创建 teammate 的请求。
 * prompt 是成员的首条用户消息；官方会在其前面插入成员身份提示（名字与 Lead 名）。
 */
export interface TeamSpawnRequestLike {
  /** 成员名：必须为小写短横线形式、长度不超过 64、且不等于 "lead"（官方校验）。 */
  name: string
  /** 成员职责简述（官方限制 200 字）。 */
  description: string
  prompt: Array<{ type: 'text'; text: string }>
  /** fresh = 不携带 Lead 历史；fork = 继承 Lead 已完成轮次。 */
  context: 'fresh' | 'fork'
  /** 承接创建的延续子代理 provider 名（须支持可延续子代理）。 */
  provider: string
  signal: AbortSignal
}

/** 创建结果：官方以 `{ member }` 包装返回成员行。 */
export interface TeamSpawnResultLike {
  member?: TeamMemberViewLike
}

/** 成员消息投递请求（target 为 teammate 名，或 "lead" 表示 Lead）。 */
export interface TeamSendRequestLike {
  target: string
  content: Array<{ type: 'text'; text: string }>
  signal: AbortSignal
}

/**
 * 投递结果：0.2.1 起为 `{ messageId }`（目标 inbox 已接受；随后执行与本次调用无关）。
 *
 * 【0.2.1 迁移】旧的 `status: 'accepted' | 'queued'` 随独立 outbox/重试机制一并移除；
 * 插件不消费投递状态（派发是否送达由编排层按成员运行态推导），故只保留 messageId。
 */
export interface TeamSendResultLike {
  messageId?: string
}

/** 官方 Team 服务最小结构（`ctx.agentTeams`）。 */
export interface AgentTeamsServiceLike {
  /** 以 Lead 身份创建一名成员；非 Lead 调用者被官方拒绝。 */
  spawnTeammate(caller: unknown, request: TeamSpawnRequestLike): Promise<TeamSpawnResultLike | undefined>
  /** 读取成员清单（含 Lead 伪行）；插件据此判定成员是否已存在以决定复用。 */
  listMembers(caller: unknown): TeamMemberViewLike[]
  /** 以成员身份向其他成员投递消息；Lead 亦为合法发送者。 */
  sendMessage(caller: unknown, request: TeamSendRequestLike): Promise<TeamSendResultLike | undefined>
}
