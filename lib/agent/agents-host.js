// src/host/agent/agents-host.ts
//
// 会话根 Agent（父代理）服务适配：CordisAgentHost 实现编排运行时的 AgentHost 缝
// （可用性/取根 Agent/followup 注入/回合终态/子代理存活），以及 agents/subagents
// 服务的惰性解析（运行时守卫，零官方类型依赖）。
// ---------------------------------------------------------------------------
// 会话事件流读取（DSH 0.1.2 适配，A4-03/A4-04）
// ---------------------------------------------------------------------------
// rc.2 时代插件直读 root.session.events（数组）；0.1.2 移除该 getter，改为按需
// `seq` / `eventAt()` / `snapshotEvents()`（SessionSeq/SessionLogOffset 为 branded
// number，运行时仍是普通非负整数）。官方类型已取证：`session.seq` 为当前长度、
// `eventAt(seq)` 取单个事件。这里用运行时守卫兼容双版本，避免零官方类型依赖被打破。
/** 会话事件倒序扫描上限（只关心最新若干条；防止极端长日志全量物化）。 */
const SESSION_EVENT_LOOKBACK = 200;
/**
 * 自会话事件流末尾向前扫描，返回首个满足 predicate 的事件（最新优先）。
 * 兼容 DSH 0.1.2（seq/eventAt）与 0.1.1（events 数组）；读取失败返回 null（降级，
 * 不抛错——看护/产出读取属辅助路径）。
 */
function scanLatestSessionEvent(session, predicate) {
    if (!session || typeof session !== 'object')
        return null;
    const s = session;
    // 长度：0.1.2 用 seq（当前日志长度）；旧版本回退 events.length。
    const seq = Number(s.seq);
    const length = Number.isFinite(seq) && seq >= 0 ? seq : (Array.isArray(s.events) ? s.events.length : 0);
    const from = Math.max(0, length - SESSION_EVENT_LOOKBACK);
    for (let index = length - 1; index >= from; index -= 1) {
        let event;
        if (typeof s.eventAt === 'function') {
            try {
                event = s.eventAt(index);
            }
            catch {
                event = undefined;
            }
        }
        if (event === undefined && Array.isArray(s.events))
            event = s.events[index];
        if (event !== null && typeof event === 'object' && predicate(event)) {
            return event;
        }
    }
    return null;
}
export class CordisAgentHost {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** 解析 agents 服务（缺省/不可用时返回 null，调用方给明确错误）。 */
    agentsService() {
        const service = this.ctx.get('agents');
        if (service !== null && typeof service === 'object' && typeof service.get === 'function') {
            return service;
        }
        return null;
    }
    available() {
        return this.agentsService() !== null;
    }
    getRootAgent(sessionId) {
        const service = this.agentsService();
        if (!service)
            return null;
        const raw = service.get(sessionId);
        if (raw === null || typeof raw !== 'object')
            return null;
        return raw;
    }
    /** 按会话 id 取子代理 agent（wf_ask_agent 投递缝用；未激活返回 null）。 */
    getChildAgent(childId) {
        const service = this.agentsService();
        if (!service)
            return null;
        try {
            const raw = service.get(childId);
            if (raw === null || typeof raw !== 'object')
                return null;
            return raw;
        }
        catch {
            return null;
        }
    }
    followupRoot(agent, message) {
        if (typeof agent.followup !== 'function') {
            throw new Error('当前会话 Agent 未激活；请先在对话区发送一条消息后重试');
        }
        agent.followup(message);
    }
    latestTurnEnd(sessionId, afterMs) {
        const root = this.getRootAgent(sessionId);
        if (!root)
            return null;
        const event = scanLatestSessionEvent(root.session, (candidate) => candidate.type === 'turn/end');
        if (!event)
            return null;
        // 最新回合在运行开始前结束 → 运行发起回合尚未结束，不判终态
        if ((Number(event.time) || 0) < afterMs)
            return null;
        const reason = event.data?.reason;
        const kind = reason?.kind;
        if (kind === 'error')
            return { kind: 'error', error: reason?.error ?? {} };
        if (kind === 'aborted')
            return { kind: 'aborted' };
        return null;
    }
    /**
     * 最近一条父代理 assistant/message 文本（afterMs 之后；无则 null）。
     * 官方 dsh-agent-loop 每步结束追加 assistant/message 事件（{ turn, step, message }，
     * message.content 为 ContentBlock[]）——取事件流中时间 >= afterMs 的最后一条
     * assistant/message 的 text 块拼接（执行者模式回写父代理节点输出用）。
     */
    latestRootAssistantText(sessionId, afterMs) {
        const root = this.getRootAgent(sessionId);
        if (!root)
            return null;
        const event = scanLatestSessionEvent(root.session, (candidate) => {
            if (candidate.type !== 'assistant/message')
                return false;
            return (Number(candidate.time) || 0) >= afterMs;
        });
        if (!event)
            return null;
        const content = event.data?.message?.content;
        if (Array.isArray(content)) {
            const joined = content
                .map((block) => {
                const value = block;
                return value && value.type === 'text' ? String(value.text ?? '') : '';
            })
                .filter(Boolean)
                .join('\n')
                .trim();
            if (joined)
                return joined;
        }
        return null;
    }
    childRunning(childId) {
        const service = this.agentsService();
        if (!service)
            return false;
        try {
            const agent = service.get(childId);
            if (agent === null || typeof agent !== 'object')
                return false;
            return agent.status === 'running';
        }
        catch {
            return true; // 查询失败保守视为仍在运行
        }
    }
}
/** agents 服务惰性解析（节点子代理执行引擎用；与 CordisAgentHost 同一官方服务）。 */
export function agentsServiceLike(ctx) {
    const service = ctx.get('agents');
    if (service !== null && typeof service === 'object' && typeof service.get === 'function') {
        return service;
    }
    return null;
}
/** subagents 服务惰性解析（子代理创建/相邻投递/中断/provider 探测使用面）。 */
export function subagentsServiceLike(ctx) {
    const service = ctx.get('subagents');
    if (service !== null && typeof service === 'object'
        && typeof service.startContinuable === 'function'
        // 0.1.2 SubagentRuntime：相邻投递三选一——sendMessage / queuePrompt（rc.1 新增），
        // 旧宿主仍走 followup（rc.2 面）。registerContinuableSetup 在 rc.1 已移除，不再判定。
        && (typeof service.sendMessage === 'function'
            || typeof service.queuePrompt === 'function'
            || typeof service.followup === 'function')
        && typeof service.interrupt === 'function') {
        return service;
    }
    return null;
}
//# sourceMappingURL=agents-host.js.map