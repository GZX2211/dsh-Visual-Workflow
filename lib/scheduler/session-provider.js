// src/host/scheduler/session-provider.ts
//
// 定时任务「新会话」模式：以编程方式创建会话 + 根 Agent（官方 ctx.agents.create，
// 工厂创建会话与 agent 并发布；创建后 agent 处于 idle，后续 startRun 的
// followupRoot 注入编排指令即唤醒回合——与 goal-round-driver 官方同款驱动模式）。
//
// 非侵入扩展（架构文档 §1）：零官方包类型依赖（运行时守卫），经 ctx.get('agents')
// 解析 create 能力；创建失败抛明确错误，由引擎按触发失败处理（不补打）。
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
            throw new Error('agents 服务不支持创建会话（agent 工厂未安装），无法执行定时任务的「新会话」模式');
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
        // 定时任务「新会话」模式触发失败。与官方 composeAgent 保持一致：仅执行挂载副作用，
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
/**
 * 解析某会话记录的工作目录（新会话继承创建者 cwd 用；读不到返回 undefined，
 * 由引擎组装时省略该字段——官方 meta.cwd 为可选）。
 */
export function sessionCwdResolver(ctx) {
    return async (sessionId) => {
        try {
            const sessions = ctx.get('sessions');
            const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.();
            const entry = (snapshot?.byId ?? {})[sessionId];
            const cwd = entry?.meta?.cwd ?? entry?.header?.meta?.cwd;
            return typeof cwd === 'string' && cwd.trim() ? cwd : undefined;
        }
        catch {
            return undefined;
        }
    };
}
//# sourceMappingURL=session-provider.js.map