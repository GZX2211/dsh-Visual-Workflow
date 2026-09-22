/** webServer 服务最小结构（官方 register 契约；kind 语义：exact 优先于最长 prefix）。 */
export interface WebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler(req: unknown, res: unknown): Promise<void> | void;
    }): () => void;
}
/**
 * 解析 webServer 服务（不可用时返回 null）。
 * 调用方决定降级语义——两个边界的既有口径一致：缺失时告警并返回 no-op disposer，
 * 不得静默失效。
 */
export declare function webServerOf(ctx: {
    get(name: string): unknown;
}): WebServerLike | null;
