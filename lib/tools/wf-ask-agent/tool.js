// src/host/tools/wf-ask-agent/tool.ts
//
// wf_ask_agent 工具注册（两态协议 ask/reply，非阻塞）。
//
// 职责边界：
//   - 本文件只做「注册（defineTool DSL）+ 投递缝构造（delivery）」；
//     归属校验（运行锁 / childIndex 表内所有权 / 会话归属）、两态协议、
//     待回复登记与 TTL 惰性清理、审计全部收敛在编排运行时（runtime.wfAskAgent）；
//   - 投递缝（AskAgentDelivery）是运行时与宿主能力之间的桥：目标在线 →
//     agent.steer（下一步边界插队）；目标不在线/冷态 → subagents.followup
//     （官方冷恢复）。ask 与 reply 双向共用同一投递语义。
//
// 非阻塞语义（本次定案）：
//   - ask 只做「投递 + 登记待回复」，随即返回受理凭证，调用方不挂起；
//   - reply 把回复文本反向投递给发起者，由发起者的后续回合处理；
//   - 超时裁决（resolve/continue/resend/abort）与父代理介入已退役。
//
// 工具可见性：
//   - 全局注册（本轮不改可见性路径）；父代理侧调用会按命令语义被拒绝
//     （ask/reply 均仅子代理可用），子代理侧为可选注入——组合勾选才进白名单。
//
// 提示词规范：description 与参数说明使用官方标准英文（W-03），第一句写明
// 「何时调用」，随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（插队投递）。
// 单条 description 目标 ≤ 120 tokens。
import { WF_ASK_AGENT } from '../../shared/protocol.js';
import { callerOf } from '../infrastructure/caller.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { textRender } from '../infrastructure/text-render.js';
/**
 * 构造投递缝（delivery）：
 *   - deliver：目标在线（可 steer）→ 插队投递（下一步边界可见）；否则冷恢复
 *     followup（父 root 授权）。ask 投递给对端、reply 投递回发起者，共用此缝。
 */
function makeDelivery(host) {
    return {
        async deliver({ sessionId, to, message, signal }) {
            const target = host.getChildAgent(to);
            if (target && typeof target.steer === 'function') {
                target.steer(message);
                return;
            }
            // 冷态回退：目标不在内存（激活已释放）→ 官方 subagents.followup 冷恢复
            const parent = host.getRootAgent(sessionId);
            if (!parent) {
                throw new Error('主会话 Agent 未激活，无法冷恢复目标子代理');
            }
            await host.followupChild(parent, to, message.content, {
                source: message.source,
                ...(signal ? { signal } : {}),
            });
        },
    };
}
/**
 * 注册 wf_ask_agent（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfAskAgent(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_ask_agent');
    }
    const delivery = makeDelivery(host);
    const def = defineTool({
        name: WF_ASK_AGENT,
        description: 'Exchange messages between agent nodes of a running workflow. ' +
            'Use inside a collaboration group: ask sends a message to a peer and returns immediately with an askId — it does not wait; ' +
            'targetChildId takes the peer node id from your collaboration block or its child session id, and the peer is reachable even when idle or stopped; ' +
            'reply answers an ask by its askId and is delivered back to the asker as a new message, so the answer arrives in a later turn rather than as this call result.',
        parameters: {
            cmd: { type: 'string', required: true, enum: ['ask', 'reply'], description: 'ask: send a message and return an askId; reply: answer an ask by its askId.' },
            targetChildId: { type: 'string', description: 'Peer node id (from your collaboration block) or child session id: the ask target (ask), or the original asker to reply to (reply).' },
            askId: { type: 'string', description: 'Ask id to answer (reply); returned as an ask result and quoted in the delivered message.' },
            message: { type: 'string', description: 'Message text (ask/reply).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    cmd: { type: 'string', required: true, enum: ['ask', 'reply'], description: 'The command that was executed.' },
                    askId: { type: 'string', description: 'The ask id (ask result; reply echoes it).' },
                    from: { type: 'string', description: 'Sender child session id.' },
                    to: { type: 'string', description: 'Target child session id.' },
                },
            },
            render: textRender,
        },
        async execute(args, exec) {
            const caller = callerOf(exec);
            const childId = String(exec?.agent?.id ?? '');
            return host.orchestrator.wfAskAgent(caller, childId, args ?? {}, delivery, exec.signal);
        },
    });
    const dispose = tools.register(def);
    return () => {
        try {
            dispose();
        }
        catch {
            // 注销尽力而为（工具可能已被外部注销）
        }
    };
}
//# sourceMappingURL=tool.js.map