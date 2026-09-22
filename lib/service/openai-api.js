// src/host/service/openai-api.ts
//
// 模式二服务进程内的 OpenAI 兼容 API **核心**（不含 HTTP 适配，见 ./openai-http.ts）：
//   - 请求解析与校验（messages 末条 user 文本、userId 必填）；
//   - 鉴权与并发上限（in-flight 计数）；
//   - 一次编排运行：userId → 会话 → 根 Agent → 编排运行（有断点自动续跑）
//     → 父代理回合事件增量推进 → 回合结束且 run 终态后收尾；
//   - 会话事件流读取适配（DSH 0.1.2 的 seq/eventAt，兼容 0.1.1 的 events）。
//
// 轮询推进同时调用 deps.sweep()（watchdog 单次扫描）——服务进程内看护周期
// 默认 15s，请求等待需主动推进状态机（父代理回合终态判定/空闲超时）。
//
// 为什么与 HTTP 层分开：本核心只依赖编排运行时与数据层的抽象缝（可纯逻辑测试），
// HTTP/SSE 是 webServer 官方契约的适配层（路由注册、响应序列化、请求体读取）——
// 两者的变化依据不同（编排契约 vs webServer 契约）。
import { findResumableRun } from '../orchestrator/index.js';
import { resolveNewSessionCwd } from '../sessions/session-provider.js';
/** OpenAI 兼容错误（status 供 HTTP 层；type/code 供 error body）。 */
export class OpenAiError extends Error {
    status;
    type;
    code;
    constructor(status, type, code, message) {
        super(message);
        this.name = 'OpenAiError';
        this.status = status;
        this.type = type;
        this.code = code;
    }
}
// 会话事件流读取（DSH 0.1.2 适配，A4-03/A4-04）：0.1.2 移除 session.events，改
// seq/eventAt() 按需读取（branded number 运行时仍是普通非负整数）；此处零官方类型
// 依赖守卫，兼容 0.1.1 的 events 数组。
/** 会话事件流当前长度：0.1.2 用 session.seq；旧版本回退 events.length。 */
function sessionEventLengthOf(session) {
    if (!session || typeof session !== 'object')
        return 0;
    const s = session;
    const viaEvents = Array.isArray(s.events) ? s.events.length : 0;
    const seq = Number(s.seq);
    if (Number.isFinite(seq) && seq >= 0) {
        // seq 权威；但「seq 与 events 并存且 seq 为 0、events 非空」的过渡/fake 态下
        // 以 events 为准（防御性：0.1.2 真会话无 events 字段，不受此分支影响）。
        return seq > 0 || viaEvents === 0 ? seq : viaEvents;
    }
    return viaEvents;
}
/** 读取第 index 个会话事件：优先 eventAt(index)（0.1.2）；越界/缺失返回 undefined。 */
function sessionEventAt(session, index) {
    if (!session || typeof session !== 'object')
        return undefined;
    const s = session;
    if (typeof s.eventAt === 'function') {
        try {
            return s.eventAt(index);
        }
        catch {
            return undefined; // 越界/校验失败：按无事件处理
        }
    }
    return Array.isArray(s.events) ? s.events[index] : undefined;
}
/** 轮询间隔（流式增量刷新/终态检测）。 */
export const OPENAI_POLL_MS = 200;
/** SSE 流式响应超时默认值（需求文档 §5：默认 5 分钟，可配置）。 */
export const DEFAULT_SSE_TIMEOUT_MS = 5 * 60 * 1000;
/** 客户端断开时的内部错误码（HTTP 层用于静默收尾）。 */
export const CLIENT_CLOSED_CODE = 'client_closed';
/** 解析并校验请求（鉴权在路由层经 headers 完成；此处校验 userId/messages）。 */
export function parseChatRequest(body, userIdFromHeader) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new OpenAiError(400, 'invalid_request_error', 'bad_request', '请求体必须为 JSON 对象');
    }
    const raw = body;
    const messages = raw.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new OpenAiError(400, 'invalid_request_error', 'bad_request', 'messages 必须为非空数组');
    }
    const userId = String(raw.user_id ?? userIdFromHeader ?? '').trim();
    if (!userId) {
        throw new OpenAiError(400, 'invalid_request_error', 'missing_user_id', '必须提供 userId（body user_id 或 Header X-User-Id）');
    }
    let question = '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const entry = messages[index];
        if (entry && entry.role === 'user') {
            question = extractText(entry.content);
            break;
        }
    }
    if (!question.trim()) {
        throw new OpenAiError(400, 'invalid_request_error', 'bad_request', 'messages 中缺少 user 文本内容');
    }
    return {
        userId,
        question: question.trim(),
        stream: raw.stream === true,
        ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    };
}
/** content 字段文本提取（字符串直接返回；块数组取 text 块拼接）。 */
function extractText(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((block) => (block && typeof block === 'object' && block.type === 'text'
            ? String(block.text ?? '')
            : ''))
            .join('');
    }
    return '';
}
/**
 * OpenAI 兼容 API 核心（纯逻辑可测；webServer 注册为薄壳，见 ./openai-http.ts）。
 */
export class OpenAiApi {
    deps;
    /** in-flight 请求计数（并发上限）。 */
    inflight = 0;
    constructor(deps) {
        this.deps = deps;
    }
    /** 鉴权校验：apiKey 配置非空时要求 Authorization: Bearer <apiKey>。 */
    authorize(authorization) {
        const key = this.deps.apiKey;
        if (!key)
            return;
        const header = String(authorization ?? '').trim();
        const expected = `Bearer ${key}`;
        if (header !== expected) {
            throw new OpenAiError(401, 'authentication_error', 'invalid_api_key', 'API Key 无效');
        }
    }
    /** 获取并发槽；超限抛 429。返回释放函数（finally 必调）。 */
    acquire() {
        const limit = this.deps.maxConcurrent > 0 ? this.deps.maxConcurrent : 1;
        if (this.inflight >= limit) {
            throw new OpenAiError(429, 'rate_limit_error', 'concurrent_limit', `并发请求超过上限（${limit}）`);
        }
        this.inflight += 1;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.inflight -= 1;
        };
    }
    /** 执行一次编排请求（wait 循环 + 事件增量回调）。 */
    async runChat(input, onDelta, options = {}) {
        // 「服务级新会话」（旧数据兼容）：服务文档 startNewSession=true 时每请求新建
        // 独立会话（cwd=工作区），请求间不连续（不复用断点）；关闭时保持
        // userId→sessionId 映射 + 断点续跑。工作台全局化改版后新服务实例不再写入该
        // 字段（保存端点剥除）——新服务恒为「userId 固定会话 + 断点续跑」语义。
        const serviceDoc = await this.deps.store.getServiceById(this.deps.serviceId).catch(() => null);
        const startNewSession = serviceDoc?.startNewSession === true;
        // 服务级新会话不继承服务归属会话的 cwd（无创建者语义）；cwd 决策仍走唯一实现。
        const workspacePath = await resolveNewSessionCwd({ workspacePath: serviceDoc?.workspacePath });
        const sessionId = startNewSession
            ? this.deps.createSession
                ? await this.deps.createSession({
                    label: `服务请求：${input.userId}`,
                    agentPreset: 'standard',
                    ...(workspacePath ? { cwd: workspacePath } : {}),
                })
                : await this.deps.resolveSession(input.userId) // 能力缺失回退映射（防御）
            : await this.deps.resolveSession(input.userId);
        const { agent } = await this.deps.ensureRootAgent(sessionId);
        const agentLike = (agent ?? null);
        if (!agentLike || typeof agentLike.followup !== 'function') {
            throw new OpenAiError(500, 'server_error', 'agent_unavailable', '服务会话 Agent 不可用');
        }
        // 有断点（暂停/中断）自动续跑；否则全新编排；新会话模式每请求全新启动
        const prev = startNewSession
            ? null
            : await findResumableRun(this.deps.store, { sessionId, flowId: this.deps.serviceId });
        const started = prev
            ? await this.deps.orchestrator.resumeRun({ sessionId, flowId: this.deps.serviceId, fromRunId: prev.id })
            : await this.deps.orchestrator.startRun({ sessionId, flowId: this.deps.serviceId, mode: 'mode2', question: input.question });
        const runId = started.runId;
        // 父代理回合事件增量推进（assistant/message 累计文本；turn/end 标记）
        let baseSeq = Number(agentLike.session?.seq ?? 0);
        let text = '';
        let turnEnded = false;
        const pollMs = this.deps.pollMs ?? OPENAI_POLL_MS;
        // 等待上界（需求 §5：SSE 超时；Bug 22——之前无限轮询，超时后停止运行并抛错）
        const timeoutMs = options.timeoutMs ?? this.deps.sseTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        // 客户端提前断开：终止后台运行（Bug 23——之前轮询继续、并发槽被占满）
        const isAborted = () => options.signal?.aborted === true;
        const abort = async () => {
            await this.deps.orchestrator.stopRun(runId).catch(() => { });
        };
        for (;;) {
            if (isAborted()) {
                await abort();
                throw new OpenAiError(499, 'client_error', CLIENT_CLOSED_CODE, '客户端已断开连接，已停止后台编排运行');
            }
            if (Date.now() >= deadline) {
                await abort();
                throw new OpenAiError(504, 'server_error', 'generation_timeout', `SSE 流式响应超时（${Math.round(timeoutMs / 1000)} 秒），已停止后台编排运行`);
            }
            await this.deps.sweep();
            const eventLength = sessionEventLengthOf(agentLike.session);
            for (let index = baseSeq; index < eventLength; index += 1) {
                const event = sessionEventAt(agentLike.session, index);
                if (!event)
                    continue;
                if (event.type === 'assistant/message' && event.data?.message?.content !== undefined) {
                    const joined = extractText(event.data.message.content);
                    if (joined && joined !== text) {
                        const delta = joined.startsWith(text) ? joined.slice(text.length) : joined;
                        text = joined;
                        if (delta && onDelta)
                            onDelta(delta);
                    }
                }
                else if (event.type === 'turn/end') {
                    turnEnded = true;
                }
            }
            baseSeq = eventLength;
            const snapshot = this.deps.orchestrator.runSnapshot(runId);
            const status = snapshot?.status;
            if (status !== undefined && status !== 'running') {
                return {
                    text,
                    status,
                    runId,
                    ...(status !== 'completed' ? { error: failureText(status, snapshot?.summary ?? '') } : {}),
                };
            }
            if (turnEnded && status === 'running') {
                // 回合已结束但 run 未终态：等待 wf_finish 收尾/看护兜底（继续轮询）
            }
            await sleep(pollMs);
        }
    }
    /** GET /v1/models：服务模型信息（父代理节点模型；缺失返回空列表）。 */
    async models() {
        const service = await this.deps.store.getServiceById(this.deps.serviceId).catch(() => null);
        const parent = service?.nodes?.find((node) => node.kind === 'parent');
        const data = parent?.data;
        const model = typeof data?.model === 'string' && data.model ? data.model : undefined;
        const provider = typeof data?.provider === 'string' && data.provider ? data.provider : undefined;
        if (model) {
            return {
                object: 'list',
                data: [{ id: model, object: 'model', owned_by: provider ?? 'workflow', created: 0 }],
            };
        }
        return { object: 'list', data: [] };
    }
}
/** 终态失败的中文描述（SSE 错误行/非流式 error 用）。 */
export function failureText(status, summary) {
    if (status === 'failed')
        return summary || '编排运行失败';
    if (status === 'stopped')
        return summary || '编排运行被停止';
    if (status === 'paused')
        return summary || '编排已暂停';
    return `编排异常结束（${status}）`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=openai-api.js.map