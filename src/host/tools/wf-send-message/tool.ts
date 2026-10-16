// src/host/tools/wf-send-message/tool.ts
//
// wf_send_message 工具注册（单向持久消息；父代理 / 普通子代理 / Team 成员三向寻址）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 投递缝构造（SendMessageDelivery）」：
//     归属校验、寻址解析（nodeId → 子代理会话 / 官方成员名）、通道选择与投递状态判定
//     全部收敛在编排运行时（runtime.wfSendMessage）；
//   - 投递缝是运行时与宿主能力之间的桥：父代理在线 steer（插队）/ 空闲 followupRoot
//     （唤醒）；普通子代理在线 steer / 离线 subagents.sendMessage 冷恢复；Team 成员走
//     官方 Team 服务（宿主直接调用，不经官方工具开关，故默认关闭官方 send_message 后
//     成员间通信仍可用）。
//
// 语义（用户裁决 2026-10）：只做官方语义的单向 durable message——投递即返回，
// 不等待回复、不含 ask/reply 两态（wf_ask_agent 已退役）。
//
// 工具可见性：全局注册；父代理与子代理均可调用，是否进入子代理工具集由组合勾选决定
// （子代理侧无强制追加，与 wf_ask_user 同口径）。
//
// 提示词规范：description 与参数说明使用官方标准英文（W-03），第一句写明「何时调用」，
// 随后是寻址面 / 失败语义（WF_* 稳定错误码）/ 副作用（插队投递）。单条 ≤ 120 tokens。

import { WF_SEND_MESSAGE } from '../../shared/protocol.js'
import type { RootAgentLike, RootInjectedMessage, SendMessageDelivery } from '../../orchestrator/index.js'
import { callerOf, type WfToolsHost } from '../infrastructure/caller.js'
import { defineTool } from '../infrastructure/define-tool.js'
import { registerTool, requireToolsService } from '../infrastructure/register-tool.js'
import { textRender } from '../infrastructure/text-render.js'

/** 宿主能力缝（index.ts 装配；单测 fake）：在 wf 工具宿主之上加三向投递能力。 */
export interface WfSendMessageHost extends WfToolsHost {
  /** 按会话 id 取子代理 agent（注册表查询；未激活返回 null）。 */
  getChildAgent(childId: string): RootAgentLike | null
  /** 父代理空闲时唤醒投递（官方注入消息契约：必须带 id/source）。 */
  followupRoot(agent: RootAgentLike, message: RootInjectedMessage): void
  /** 冷态投递：复用子代理派发协作消息（官方 subagents.sendMessage）。 */
  followupChild(
    parent: RootAgentLike,
    childId: string,
    content: unknown[],
    options: { source: unknown; signal?: AbortSignal },
  ): Promise<unknown>
  /** 官方 Team 成员投递（成员名寻址；官方 Team 服务不可用时由注册前置条件排除）。 */
  sendToTeammate(
    parent: RootAgentLike,
    memberName: string,
    content: unknown[],
    options: { signal?: AbortSignal },
  ): Promise<unknown>
}

/**
 * 构造投递缝（delivery）：
 *   - 父代理：运行中插队（delivered）；空闲走 followupRoot 唤醒（queued）；
 *   - 普通子代理：有在线实例插队（delivered）；否则冷恢复（resumed）；
 *   - Team 成员：官方 Team 服务投递（状态由编排层按成员运行态推导，故此处只投递）。
 */
function makeDelivery(host: WfSendMessageHost): SendMessageDelivery {
  return {
    async deliverToParent({ sessionId, message }) {
      const root = host.getRootAgent(sessionId)
      if (!root) throw new Error('主会话 Agent 未激活，无法投递消息给父代理')
      if (root.status === 'running' && typeof root.steer === 'function') {
        root.steer(message)
        return 'delivered'
      }
      // 空闲唤醒：followupRoot 只接受官方注入消息形状（source 固定为 user）
      host.followupRoot(root, { id: message.id, role: 'user', content: message.content, source: { kind: 'user' } })
      return 'queued'
    },

    async deliverToChild({ sessionId, childId, message, signal }) {
      const target = host.getChildAgent(childId)
      if (target && typeof target.steer === 'function') {
        target.steer(message)
        return 'delivered'
      }
      // 冷态：目标不在内存（回合间激活已释放）→ 官方 sendMessage 冷恢复并投递
      const parent = host.getRootAgent(sessionId)
      if (!parent) throw new Error('主会话 Agent 未激活，无法冷恢复目标子代理')
      await host.followupChild(parent, childId, message.content, {
        source: message.source,
        ...(signal ? { signal } : {}),
      })
      return 'resumed'
    },

    async deliverToTeammate({ sessionId, memberName, message, signal }) {
      const parent = host.getRootAgent(sessionId)
      if (!parent) throw new Error('主会话 Agent 未激活，无法投递消息给 Team 成员')
      await host.sendToTeammate(parent, memberName, message.content, signal ? { signal } : {})
    },
  }
}

/**
 * 注册 wf_send_message（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfSendMessage(
  ctx: { get(name: string): unknown },
  host: WfSendMessageHost,
): () => void {
  const tools = requireToolsService(ctx, WF_SEND_MESSAGE)

  const delivery = makeDelivery(host)

  const def = defineTool({
    name: WF_SEND_MESSAGE,
    description:
      'Send one durable message to the parent agent or to another member node of the running workflow. ' +
      'Use it to hand over a finding, request a decision, or coordinate with a teammate. ' +
      'It returns as soon as the message is delivered, queued, or has woken an idle target — it does not wait for a reply. ' +
      'target is either "parent" or a node id from your reachable-agent list. ' +
      'Fails with WF_SEND_TARGET_UNKNOWN when the target is not an active member of this run, and with WF_SEND_DELIVERY_FAILED when delivery fails (retryable).',
    parameters: {
      target: { type: 'string', required: true, description: 'Required: "parent" for the parent agent, or a node id from your reachable-agent list.' },
      message: { type: 'string', required: true, description: 'Required: the message text to deliver.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true, description: 'The target as requested ("parent" or a member node id).' },
          resolved: { type: 'string', description: 'The delivery object: "parent", a child session id, or an official team member name.' },
          status: { type: 'string', enum: ['delivered', 'queued', 'resumed'] as const, description: 'delivered: reached a running target; queued: enqueued while the target is still starting; resumed: an idle or stopped target was woken up.' },
        },
      },
      render: textRender,
    },
    async execute(args, exec) {
      const caller = callerOf(exec)
      const childId = String((exec?.agent as { id?: unknown } | null | undefined)?.id ?? '')
      return host.orchestrator.wfSendMessage(caller, childId, args ?? {}, delivery, exec.signal)
    },
  })

  return registerTool(tools, def)
}
