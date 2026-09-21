import { type WfToolsHost } from '../infrastructure/caller.js';
/**
 * 注册 wf_run_node_wait（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfRunNodeWait(ctx: {
    get(name: string): unknown;
}, host: WfToolsHost): () => void;
