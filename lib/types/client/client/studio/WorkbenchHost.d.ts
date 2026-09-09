import type { Dict } from '../i18n.js';
/** 宿主上下文（兼容官方 client 注入的 ctx 最小形状）。 */
export interface WorkbenchHostContext {
    get?(name: string): unknown;
    effect?(fn: () => (() => void) | void, label?: string): unknown;
    locale?: unknown;
}
/** 会话树根 id 解析（实例/服务按会话树根隔离）。 */
export declare function rootSessionIdOf(current: string, sessions: {
    list?: {
        getSnapshot?(): {
            current?: unknown;
            byId?: Record<string, unknown>;
        };
        get?(): {
            current?: unknown;
            byId?: Record<string, unknown>;
        };
    };
} | null | undefined): string;
/** 工作台宿主组件。 */
export declare function WorkbenchHost({ ctx, t }: {
    ctx: WorkbenchHostContext;
    t: Dict;
}): import("react").JSX.Element | null;
