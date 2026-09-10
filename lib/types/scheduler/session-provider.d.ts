import type { Context } from '@deepseek-ai/cordis';
/** 新会话创建缝（引擎依赖；单测 fake）。 */
export interface SessionProvider {
    /**
     * 创建新会话（含根 Agent）并返回会话 id。
     * @param options.label 会话来源标识（写入用途说明；元信息可追溯）
     * @param options.agentPreset 官方预设 id（缺省 standard：父代理具备官方标准工具集）
     * @param options.cwd 可选工作目录（继承创建者会话；解析不到时省略）
     */
    createSession(options: {
        label: string;
        agentPreset?: string;
        cwd?: string;
    }): Promise<string>;
}
/** Cordis 实现：经 ctx.agents.create 创建会话与根 Agent（工厂缺失时抛出明确错误）。 */
export declare class CordisSessionProvider implements SessionProvider {
    private readonly ctx;
    constructor(ctx: Context);
    createSession(options: {
        label: string;
        agentPreset?: string;
        cwd?: string;
    }): Promise<string>;
}
/**
 * 解析某会话记录的工作目录（新会话继承创建者 cwd 用；读不到返回 undefined，
 * 由引擎组装时省略该字段——官方 meta.cwd 为可选）。
 *
 * 【0.1.5-rc.1 适配】host 侧 `ctx.sessions` 是 SessionStore：`list()` 是**方法**
 * （返回 Session[]），**不存在** list.getSnapshot() / list.get() / byId / current /
 * subscribe（取证：dsh-session/lib/types/index.d.ts 的 SessionStore.get/list）。
 * 旧实现只走快照读法，在新宿主上恒返回 undefined，导致定时任务「新会话」模式
 * 静默丢失 cwd 继承。正确读法：`sessions.get(id)?.header?.cwd`。
 * 快照读法保留为兜底（旧宿主容忍）；两条路径都只是运行时守卫读取，无副作用。
 * @param ctx - 取服务的最小上下文（`get(name)`）。
 * @returns 按会话 id 解析 cwd 的异步函数（任何异常都降级为 undefined）。
 */
export declare function sessionCwdResolver(ctx: {
    get(name: string): unknown;
}): (sessionId: string) => Promise<string | undefined>;
