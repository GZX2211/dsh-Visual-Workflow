// src/host/sessions/session-provider.ts
//
// 官方会话 / Agent 服务的运行时能力适配（零官方包类型依赖，全部经运行时守卫）：
//   - 创建新会话 + 根 Agent（ctx.agents.create + agentPresets.resolve/mount）；
//   - 解析某会话记录的工作目录（ctx.sessions 的两代读法）；
//   - 新会话工作目录决策（显式路径优先，否则继承创建者会话 cwd）。
//
// 为什么独立于 scheduler / service：这三项能力被多个域共同消费——定时任务触发
// （scheduler）、模式二服务进程的新会话请求（service）、GUI「开启新会话」端点
// （remote）——放在任一业务域内都会造成其它域反向依赖该业务域。本模块只做
// 「官方服务 → 本插件语义」的适配与决策，不拥有任何业务状态。
//
// 非侵入扩展（架构文档 §1）：经 ctx.get('agents') / ctx.get('agentPresets') /
// ctx.get('sessions') 解析能力；创建失败抛明确错误，由调用方按各自的失败语义处理
// （定时任务=触发失败不补打；服务请求=500；GUI 端点=HTTP 错误）。
import { randomUUID } from 'node:crypto';
/** Cordis 实现：经 ctx.agents.create 创建会话与根 Agent（工厂缺失时抛出明确错误）。 */
export class CordisSessionProvider {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async createSession(options) {
        const agents = this.ctx.get('agents');
        if (!agents || typeof agents.create !== 'function') {
            throw new Error('agents 服务不支持创建会话（agent 工厂未安装），无法执行「新会话」模式');
        }
        // 预设装配：agentPreset 不只写入会话 header，还必须在创建 setup 里把所属 preset
        // 挂载到该 Agent 的作用域（官方 api-proxy composeAgent 同源：先 resolve 得 resolved id
        // 供 header 记录，再在 setup 内 agentPresets.mount，使官方工具/prompt 段对 agent 可见）。
        // 只写 header 不 mount 会让新会话的根 Agent 仅继承全局层（宿主 + 插件 wf_* + MCP）工具，
        // 官方 standard 预设的工具（bash/pwsh/fs/jobs/skill/goal/subagent/workflow/web…）全部缺失。
        //
        // 关键约定：setup 必须「await 挂载但【不返回】mount 的结果」。官方 agent 工厂在
        // setup 完成后会对返回值调用 `.commit()`（dsh-agent-loop setupAndPublish：
        // `(await setup?.(agent.ctx))?.commit()`）。agentPresets.mount 返回的是被组装
        // 的 preset 对象（无 `.commit` 方法），若把它作为 setup 返回值，触发时会在
        // `.commit()` 处抛出 `(intermediate value).commit is not a function`，导致
        // 新会话创建失败。与官方 composeAgent 保持一致：仅执行挂载副作用，
        // 返回 void（`.commit()` 对空值安全短路；preset 子树随 agent fiber 自动卸载）。
        const presetId = options.agentPreset ?? 'standard';
        const agentPresets = this.ctx.get('agentPresets');
        if (agentPresets && typeof agentPresets.resolve === 'function' && typeof agentPresets.mount === 'function') {
            const resolvedPresetId = (await agentPresets.resolve(presetId)).id;
            const mountPreset = async (agentCtx) => {
                await agentPresets.mount(agentCtx, resolvedPresetId);
            };
            const sessionId = `sched-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
            await agents.create({
                sessionId,
                meta: {
                    ...(options.cwd ? { cwd: options.cwd } : {}),
                    agentPreset: resolvedPresetId,
                },
                setup: mountPreset,
            });
            return sessionId;
        }
        const sessionId = `sched-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        await agents.create({
            sessionId,
            meta: {
                ...(options.cwd ? { cwd: options.cwd } : {}),
            },
        });
        return sessionId;
    }
}
/** 0.1.5-rc.1 读法：SessionStore.get(id)?.header?.cwd（Session.header 为 SessionHeader）。 */
function readCwdFromSessionStore(sessions, sessionId) {
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined;
    return session?.header?.cwd;
}
/** ≤0.1.2 兜底读法：快照 store 的 byId[id]（meta.cwd / header.meta.cwd）。 */
function readCwdFromSnapshot(sessions, sessionId) {
    const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.();
    const entry = (snapshot?.byId ?? {})[sessionId];
    return entry?.meta?.cwd ?? entry?.header?.meta?.cwd;
}
/**
 * 解析某会话记录的工作目录（新会话继承创建者 cwd 用；读不到返回 undefined，
 * 由调用方组装时省略该字段——官方 meta.cwd 为可选）。
 *
 * 【0.1.5-rc.1 适配】host 侧 `ctx.sessions` 是 SessionStore：`list()` 是**方法**
 * （返回 Session[]），**不存在** list.getSnapshot() / list.get() / byId / current /
 * subscribe（取证：dsh-session/lib/types/index.d.ts 的 SessionStore.get/list）。
 * 旧实现只走快照读法，在新宿主上恒返回 undefined，导致「新会话」模式
 * 静默丢失 cwd 继承。正确读法：`sessions.get(id)?.header?.cwd`。
 * 快照读法保留为兜底（旧宿主容忍）；两条路径都只是运行时守卫读取，无副作用。
 * @param ctx - 取服务的最小上下文（`get(name)`）。
 * @returns 按会话 id 解析 cwd 的异步函数（任何异常都降级为 undefined）。
 */
export function sessionCwdResolver(ctx) {
    return async (sessionId) => {
        try {
            const sessions = ctx.get('sessions');
            const cwd = readCwdFromSessionStore(sessions, sessionId) ?? readCwdFromSnapshot(sessions, sessionId);
            return typeof cwd === 'string' && cwd.trim() ? cwd : undefined;
        }
        catch {
            return undefined;
        }
    };
}
/**
 * 解析新会话的工作目录（**唯一实现**，禁止在调用方另行复制该决策）：
 *   - 显式 workspacePath 非空 → 采用该路径（不继承创建者）；
 *   - 否则继承创建者会话 cwd（解析失败/读不到 → 省略，用官方默认工作区）；
 *   - 都没有 → undefined（调用方省略 cwd 字段）。
 *
 * 只做「选择」不做「校验」：校验责任在保存端点（见 NewSessionCwdInput.workspacePath）。
 */
export async function resolveNewSessionCwd(input) {
    const explicit = String(input.workspacePath ?? '').trim();
    if (explicit)
        return explicit;
    if (input.creatorSessionId && input.sessionCwdOf) {
        return await input.sessionCwdOf(input.creatorSessionId).catch(() => undefined);
    }
    return undefined;
}
//# sourceMappingURL=session-provider.js.map