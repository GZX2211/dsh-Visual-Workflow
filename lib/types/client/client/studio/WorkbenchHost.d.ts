import type { Dict } from '../i18n.js';
import { currentSessionOf, rootSessionIdOf } from '../sidebar/session-root.js';
export { currentSessionOf, rootSessionIdOf };
/** 宿主上下文（兼容官方 client 注入的 ctx 最小形状）。 */
export interface WorkbenchHostContext {
    get?(name: string): unknown;
    effect?(fn: () => (() => void) | void, label?: string): unknown;
    locale?: unknown;
}
/**
 * 工作台宿主组件。
 * @param ctx - 官方 client 上下文（仅用于读取 sessions 快照）。
 * @param t - 文案词典（语言切换时由 entry.ts 重渲染传入）。
 */
export declare function WorkbenchHost({ ctx, t }: {
    ctx: WorkbenchHostContext;
    t: Dict;
}): import("react").JSX.Element;
