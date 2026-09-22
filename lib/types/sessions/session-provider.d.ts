import type { Context } from '@deepseek-ai/cordis';
/** 新会话创建缝（调用方依赖；单测 fake）。 */
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
export declare function sessionCwdResolver(ctx: {
    get(name: string): unknown;
}): (sessionId: string) => Promise<string | undefined>;
/** 新会话工作目录决策输入。 */
export interface NewSessionCwdInput {
    /**
     * 显式工作区路径（绝对目录）。
     * 不变式：**存在性校验由接受该配置的保存端点负责**（工作流实例创建、定时任务保存、
     * 服务文档保存，见 `./workspace-path.ts` 的 `resolveWorkspacePath`）；
     * 运行期创建会话不重复读盘校验——避免每次触发/每请求额外一次文件 IO，
     * 且路径失效属运行期失败（按调用方各自的失败语义处理）。
     */
    workspacePath?: string | null;
    /** 创建者会话 id（继承 cwd 的来源；缺失则该路省略）。 */
    creatorSessionId?: string | null;
    /** 会话 cwd 解析能力（宿主注入；缺失时省略继承）。 */
    sessionCwdOf?: (sessionId: string) => Promise<string | undefined>;
}
/**
 * 解析新会话的工作目录（**唯一实现**，禁止在调用方另行复制该决策）：
 *   - 显式 workspacePath 非空 → 采用该路径（不继承创建者）；
 *   - 否则继承创建者会话 cwd（解析失败/读不到 → 省略，用官方默认工作区）；
 *   - 都没有 → undefined（调用方省略 cwd 字段）。
 *
 * 只做「选择」不做「校验」：校验责任在保存端点（见 NewSessionCwdInput.workspacePath）。
 */
export declare function resolveNewSessionCwd(input: NewSessionCwdInput): Promise<string | undefined>;
