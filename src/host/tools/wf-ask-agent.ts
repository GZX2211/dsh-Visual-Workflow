// src/host/tools/wf-ask-agent.ts
//
// wf_ask_agent 工具注册（三态协议 ask/reply/resolve）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 投递缝构造（delivery）」；
//     归属校验（运行锁 / childIndex 表内所有权 / 会话归属）、三态状态机、
//     超时计时与裁决、审计全部收敛在编排运行时（runtime.wfAskAgent）；
//   - 投递缝（AskAgentDelivery）是运行时与宿主能力之间的桥：目标在线 →
//     agent.steer（下一步边界插队）；目标不在线/冷态 → subagents.followup
//     （官方冷恢复）；超时 → 超时详情 steer 注入父代理（其回合内征询用户）。
//
// 工具可见性：
//   - 父代理可见（resolve 裁决能力内聚）；子代理侧为可选注入——组合勾选才进
//     白名单（共享协议常量表），本层不额外隐藏。
//
// 提示词规范：description 与参数说明使用官方标准英文（W-03），第一句写明
// 「何时调用」，随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（阻塞 /
// 插队）；单条 description 目标 ≤ 120 tokens。

import { WF_ASK_AGENT } from '../shared/protocol.js'
import type { AskAgentDelivery, OrchestratorRuntime, RootAgentLike } from '../orchestrator/runtime.js'
import { callerOf, type WfToolsHost } from './wf-tools.js'
import { defineTool, type ToolDefinitionLike } from './define-tool.js'
import { textRender } from './text-render.js'

/** 宿主能力缝（index.ts 装配；单测 fake）：在 wf 工具宿主之上加子代理查询与冷恢复。 */
export interface WfAskAgentHost extends WfToolsHost {
  /** 按会话 id 取子代理 agent（注册表查询；未激活返回 null）。 */
  getChildAgent(childId: string): RootAgentLike | null
  /** 冷态投递：复用子代理派发协作消息（官方 subagents.followup）。 */
  followupChild(
    parent: RootAgentLike,
    childId: string,
    content: unknown[],
    options: { source: unknown; signal?: AbortSignal },
  ): Promise<unknown>
}

/**
 * 构造投递缝（delivery）：
 *   - deliver：目标在线（可 steer）→ 插队投递（下一步边界可见）；否则冷恢复
 *     followup（父 root 授权）；
 *   - notifyParent：超时详情 steer 注入父代理（父代理在下一回合征询用户并 resolve）。
 */
function makeDelivery(host: WfAskAgentHost): AskAgentDelivery {
  return {
    async deliver({ sessionId, to, message, signal }) {
      const target = host.getChildAgent(to)
      if (target && typeof target.steer === 'function') {
        target.steer(message)
        return
      }
      // 冷态回退：目标不在内存（激活已释放）→ 官方 subagents.followup 冷恢复
      const parent = host.getRootAgent(sessionId)
      if (!parent) {
        throw new Error('主会话 Agent 未激活，无法冷恢复目标子代理')
      }
      await host.followupChild(parent, to, message.content, {
        source: message.source,
        ...(signal ? { signal } : {}),
      })
    },
    notifyParent({ sessionId, message }) {
      const root = host.getRootAgent(sessionId)
      if (root && typeof root.steer === 'function') root.steer(message)
    },
  }
}

/**
 * 注册 wf_ask_agent（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfAskAgent(
  ctx: { get(name: string): unknown },
  host: WfAskAgentHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_ask_agent')
  }

  const delivery = makeDelivery(host)

  const def = defineTool({
    name: WF_ASK_AGENT,
    description:
      'Exchange blocking messages between agent nodes of the running workflow. ' +
      'Use inside a collaboration group: ask sends a message to a peer and blocks until the peer replies; ' +
      'targetChildId takes the peer node id from your collaboration block, or its child session id, and the peer is reachable even when idle or stopped (cold-resumed and woken); ' +
      'reply answers an ask by its askId and unblocks the sender; resolve settles an ask that timed out (default 120 s) — parent agent only, after consulting the user. ' +
      'Fails with WF_* codes on invalid targets, ownership violations, or after the run stops.',
    parameters: {
      cmd: { type: 'string', required: true, enum: ['ask', 'reply', 'resolve'] as const, description: 'ask: send and block; reply: answer an ask; resolve: settle a timed-out ask (parent only).' },
      targetChildId: { type: 'string', description: 'Peer node id (from your collaboration block) or child session id: the ask target (ask), or the original sender to reply to (reply).' },
      askId: { type: 'string', description: 'Ask id to reply to (reply) or settle (resolve); returned by the ask caller via the delivered message.' },
      message: { type: 'string', description: 'Message text (ask/reply); optional explanatory note on resolve.' },
      action: { type: 'string', enum: ['continue', 'resend', 'abort'] as const, description: 'resolve action: continue waiting, resend the ask, or abort it (the sender gets a timeout error).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cmd: { type: 'string', required: true, enum: ['ask', 'reply', 'resolve'] as const, description: 'The command that was executed.' },
          askId: { type: 'string', description: 'The ask id (reply/resolve; ask result).' },
          from: { type: 'string', description: 'Sender child session id (reply/ask result).' },
          to: { type: 'string', description: 'Target child session id (reply/ask result).' },
          reply: { type: 'string', description: 'The reply text (ask result, after the peer answered).' },
          action: { type: 'string', enum: ['continue', 'resend', 'abort'] as const, description: 'The resolve action taken.' },
        },
      },
      render: textRender,
    },
    async execute(args, exec) {
      const caller = callerOf(exec)
      const childId = String((exec?.agent as { id?: unknown } | null | undefined)?.id ?? '')
      return host.orchestrator.wfAskAgent(caller, childId, args ?? {}, delivery, exec.signal)
    },
  })

  const dispose = tools.register(def)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为（工具可能已被外部注销）
    }
  }
}
