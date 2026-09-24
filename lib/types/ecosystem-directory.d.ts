/** 官方 agentPreset 条目的稳定投影（字段保留原值，由调用方按需收敛；broken 项已剔除）。 */
export interface AgentPresetEntry {
    id: unknown;
    name: unknown;
    description: unknown;
    /**
     * 官方 0.1.7-rc.1 **已不发布**该字段（dsh-agent-preset-registry/lib/types/preset.d.ts
     * L4-10 只有 id/name/description/order/broken）。保留为兼容占位，恒为 `'user'`；
     * client 侧 `PresetItem.trust?` 为可选，不消费其取值。
     */
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
 *
 * 【0.1.7-rc.1 取证】`AgentPreset.broken` 由 0.1.5-rc.3 的布尔 `true` 改为
 * **诊断字符串**（`error.message`，见 dsh-agent-preset-registry/lib/types/preset.d.ts
 * L9 与实现 lib/index.js L549 `record.broken = error.message`；可用条目则不含该键）。
 * 故判定口径改为「只有 `broken === undefined` 才视为可用」——旧的 `!== true` 判定在
 * 0.1.7 上恒真，会把激活失败的 preset 一并放进 GUI 与节点模式选择。
 */
export declare function listAgentPresets(ctx: CtxLike): Promise<AgentPresetEntry[] | null>;
/**
 * 可选模型清单（llm 服务或 listModels 缺失返回空数组；单 provider 失败跳过）。
 * provider 标识按 id → name 回退解析（只有 name 的条目不再被静默丢弃）。
 */
export declare function listEcosystemModels(ctx: CtxLike): Promise<ModelEntry[]>;
export {};
