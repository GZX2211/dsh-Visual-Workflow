import type { FlowStore } from '../storage/flow-store.js';
/** 会话 id 前缀（与官方 headless one-shot 的 session-<uuid> 形态一致）。 */
export declare const SESSION_ID_PREFIX = "session-";
export interface SessionMapDeps {
    /** 数据层（userIdMap 读 / mergeUserIdMap 原子合并写）。 */
    store: FlowStore;
    /** 服务 id（映射文件按服务隔离）。 */
    serviceId: string;
    /** 新 sessionId 生成器（测试可控；缺省 randomUUID）。 */
    newSessionId?: () => string;
}
/**
 * userId → sessionId 映射表（每服务一个实例）。
 * resolve 为幂等通道：同 userId 恒返回同 sessionId（缓存命中即返回）。
 */
export declare class SessionMap {
    private readonly deps;
    private readonly cache;
    private readonly pending;
    constructor(deps: SessionMapDeps);
    /** 取 userId 的稳定 sessionId（首次解析时持久化映射并缓存）。 */
    resolve(userId: string): Promise<string>;
    /** 已解析的 sessionId 快照（测试/诊断用）。 */
    snapshot(): ReadonlyMap<string, string>;
    private ensure;
}
