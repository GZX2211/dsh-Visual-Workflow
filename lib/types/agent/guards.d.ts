import type { NodeRunner } from '../orchestrator/runtime.js';
/** 软截停的强制收尾指令（面向模型，英文；W-03 面向模型的文本与工具描述一致）。 */
export declare const REACT_CAP_MESSAGE: string;
/** tools.guard 拒绝原因（面向模型，英文）。 */
export declare const REACT_CAP_DENY_REASON = "ReAct iteration limit reached \u2014 conclude this turn with your final output now.";
/** 守卫注入点的最小结构（childCtx 形状，运行时守卫收窄）。 */
export interface GuardChildContext {
    /** cordis 事件注册（waterfall 语义由事件本身决定）。 */
    on(name: string, listener: (payload: unknown, next?: () => Promise<unknown>) => unknown): () => void;
    /** 工具服务（child scope 的 tools.guard 只影响该子代理）。 */
    tools?: {
        guard(guard: (exec: {
            name?: unknown;
            agent?: {
                id?: unknown;
            };
        }) => string | undefined): () => void;
    } | null;
    /** 服务解析（tools 缺省时经此回退获取）。 */
    get?(name: string): unknown;
}
/** 软截停护栏桥（runner 与编排器使用；NodeRunner.consumeReactCapped 的来源）。 */
export interface ReactGuardBridge {
    /** 登记/更新某 child 的 ReAct 上限（undefined = 不设限，护栏完全旁路）。 */
    setLimit(childId: string, limit: number | undefined): void;
    /** 移除某 child 的登记（子代理清理）。 */
    drop(childId: string): void;
    /** 消费软截停标记：该 child 最近一次任务是否触达上限（消费后清除）。 */
    consumeCapped(childId: string): boolean;
}
/**
 * 创建软截停护栏：返回桥（runner 登记上限/编排器消费标记）与贡献
 * （经 ctx.subagents.registerContinuableSetup 注入每个子代理的未发布 childCtx，
 * 官方 activation-setup-registry L26 契约：(childCtx) => disposer）。
 */
export declare function createReactGuard(): {
    bridge: ReactGuardBridge;
    contribution: (childCtx: unknown) => () => void;
};
/** 从 bridge 派生 NodeRunner.consumeReactCapped 适配（runner 装配用）。 */
export declare function consumeReactCappedOf(bridge: ReactGuardBridge): NonNullable<NodeRunner['consumeReactCapped']>;
