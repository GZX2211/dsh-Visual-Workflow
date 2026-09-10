import { workbenchTabDefinition } from './sidebar/workbench-tab.js';
import { createWorkbenchOpener } from './sidebar/footer-entry.js';
import { currentSessionOf, rootSessionIdOf, type SessionsServiceLike } from './sidebar/session-root.js';
import './entry.css';
/** i18n 命名空间（注册进官方 locale 服务）。 */
export declare const I18N_NS = "visualWorkflow";
export { currentSessionOf, rootSessionIdOf };
export type { SessionsServiceLike };
/** 插件 apply 上下文的最小形状（官方 client 注入的 ctx；运行时守卫）。 */
export interface ClientPluginContext {
    get?(name: string): unknown;
    effect?(fn: () => (() => void) | void, label?: string): unknown;
    /** cordis 子 fiber 悬挂：等服务就绪后运行回调，服务变化时卸载并重跑。 */
    inject?(deps: string[], callback: (scoped: ClientPluginContext) => void): unknown;
    locale?: unknown;
}
export declare const inject: string[];
/** 测试导出（client-smoke 渲染路径验证）。 */
export declare const VisualWorkflowView: null;
export declare const __test: {
    workbenchTabDefinition: typeof workbenchTabDefinition;
    createWorkbenchOpener: typeof createWorkbenchOpener;
};
/**
 * 插件 apply 入口。
 * @param ctx - 官方 client 插件上下文（服务经 ctx.get 运行时解析）。
 */
export declare function apply(ctx: ClientPluginContext): void;
