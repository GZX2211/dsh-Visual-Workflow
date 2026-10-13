import type { ToolDefinitionLike } from './define-tool.js';
/** tools 服务最小缝（官方 ctx.tools.register 的窄化投影）。 */
export interface ToolsRegistryLike {
    register(def: ToolDefinitionLike): () => void;
}
/**
 * 取 tools 服务；缺失或形状漂移（register 不是函数）时抛统一错误。
 * 消息带工具名：装配期失败要能立刻定位是哪个工具没装上。
 */
export declare function requireToolsService(ctx: {
    get(name: string): unknown;
}, toolName: string): ToolsRegistryLike;
/**
 * 注册工具定义并返回 disposer：注销失败尽力而为——工具可能已被外部注销，此时
 * 宿主清理链不应被中断（重复注销是幂等语义的正常分支，不是错误）。
 */
export declare function registerTool(tools: ToolsRegistryLike, definition: ToolDefinitionLike): () => void;
