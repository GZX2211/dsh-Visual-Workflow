import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
/** 插件 apply 入口：实例化并注册 visualWorkflowHost service（随 fiber 自动注销）。 */
export declare function apply(ctx: Context, config: Config): void;
export { name, inject, Config } from './config.js';
export { VisualWorkflowHost, VisualWorkflowHostServiceName } from './visual-workflow-host.js';
