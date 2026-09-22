/** 官方 agentPreset 条目的稳定投影（字段保留原值，由调用方按需收敛；broken 项已剔除）。 */
export interface AgentPresetEntry {
    id: unknown;
    name: unknown;
    description: unknown;
    trust: unknown;
}
/** 官方模型条目的稳定投影（efforts 为思考强度档位；官方未公布时省略）。 */
export interface ModelEntry {
    provider: string;
    model: string;
    efforts?: Array<{
        id: string;
        name: string;
    }>;
}
/** 仅需 ctx.get 的最小宿主缝（GUI 端点基座与 Service 均满足）。 */
interface CtxLike {
    get(name: string): unknown;
}
/**
 * agent preset 模式清单（agentPresets 服务缺失时返回 null；list 抛错向上抛）。
 * broken === true 的条目剔除（官方标记的不可用 preset）。
 */
export declare function listAgentPresets(ctx: CtxLike): Promise<AgentPresetEntry[] | null>;
/**
 * 可选模型清单（llm 服务或 listModels 缺失返回空数组；单 provider 失败跳过）。
 * provider 标识按 id → name 回退解析（只有 name 的条目不再被静默丢弃）。
 */
export declare function listEcosystemModels(ctx: CtxLike): Promise<ModelEntry[]>;
export {};
