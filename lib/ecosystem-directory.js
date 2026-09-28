// src/host/ecosystem-directory.ts
//
// 官方生态服务（agentPresets / llm）的 Host 级枚举契约单一来源。
//
// 为什么两处共用一份实现：GUI 组合管理端点（api/ecosystem.ts）与自主编排勘察工具
// （host 装配注入的 ecosystemAdapters）读的是同一批官方能力，两处各自写结构守卫与
// 字段映射，会让同一官方服务出现两个漂移点——官方形状升级时一处跟着改、另一处静默
// 返回空列表（对模型表现为「没有可用 preset/模型」）。
//
// 本文件只做「官方服务 → 稳定清单」的投影，不决定降级语义：服务缺失返回 null / 空
// 数组，list 抛错向上抛，由调用方分别翻译（GUI 端点报错，工具勘察 best-effort 返回空）。
//
// 官方形状取证（2026.09）：模型条目的思考强度档位**不在** `llm.listModels()` 的条目上
// （`LlmModelInfo` 只有 provider/id/name/description/inputModalities），只由
// `llm.resolveModelInfo(provider, model)` 的 `reasoning.efforts` 公布——见 reasoningEffortsOf。
/**
 * agent preset 模式清单（agentPresets 服务缺失时返回 null；list 抛错向上抛）。
 *
 * 【0.1.7-rc.1 取证】`AgentPreset.broken` 由 0.1.5-rc.3 的布尔 `true` 改为
 * **诊断字符串**（`error.message`，见 dsh-agent-preset-registry/lib/types/preset.d.ts
 * L9 与实现 lib/index.js L549 `record.broken = error.message`；可用条目则不含该键）。
 * 故判定口径改为「只有 `broken === undefined` 才视为可用」——旧的 `!== true` 判定在
 * 0.1.7 上恒真，会把激活失败的 preset 一并放进 GUI 与节点模式选择。
 */
export async function listAgentPresets(ctx) {
    const agentPresets = ctx.get('agentPresets');
    if (!agentPresets || typeof agentPresets.list !== 'function')
        return null;
    const items = (await agentPresets.list()) ?? [];
    return items
        .filter((item) => item.broken === undefined)
        .map((item) => {
        const entry = item;
        return {
            id: entry.id,
            name: entry.name ?? entry.metadata?.name ?? entry.id,
            description: entry.description ?? entry.metadata?.description ?? '',
            trust: entry.trust ?? 'user',
        };
    });
}
/**
 * 某一 provider/model 路由公布的思考强度档位（best-effort：解析失败即视为未公布）。
 *
 * 为什么必须经 resolveModelInfo：官方 `llm.listModels()` 返回的条目是 `LlmModelInfo`
 * （provider/id/name/description/inputModalities），**不含档位**；档位只由
 * `LlmResolvedModelInfo.reasoning.efforts` 公布。实机取证（2026.09）：在目录项上读 efforts
 * 恒为空，导致 GUI 模型下拉的档位与目录索引的 models[].efforts 一直是空的。
 * 单条解析失败只让该模型不带档位：与「单 provider 失败跳过」同口径，不阻断整体枚举。
 */
async function reasoningEffortsOf(llm, provider, model) {
    if (typeof llm.resolveModelInfo !== 'function')
        return [];
    let info;
    try {
        info = await llm.resolveModelInfo(provider, model);
    }
    catch {
        return [];
    }
    const efforts = info?.reasoning?.efforts;
    if (!Array.isArray(efforts))
        return [];
    return efforts
        .map((effort) => {
        const entry = (effort ?? {});
        return { id: String(entry.id ?? ''), name: String(entry.name ?? entry.id ?? '') };
    })
        .filter((effort) => effort.id);
}
/**
 * 可选模型清单（llm 服务或 listModels 缺失返回空数组；单 provider 失败跳过）。
 * provider 标识按 id → name 回退解析（只有 name 的条目不再被静默丢弃）。
 */
export async function listEcosystemModels(ctx) {
    const llm = ctx.get('llm');
    if (!llm || typeof llm.listProviders !== 'function')
        return [];
    let providers = [];
    try {
        providers = llm.listProviders() ?? [];
    }
    catch {
        providers = [];
    }
    const out = [];
    for (const entry of providers) {
        const name = typeof entry === 'string' ? entry : (entry?.id ?? entry?.name);
        if (!name)
            continue;
        if (typeof llm.listModels !== 'function')
            continue;
        try {
            const models = (await llm.listModels(String(name))) ?? [];
            for (const model of models ?? []) {
                const info = typeof model === 'string' ? null : model;
                const id = typeof model === 'string' ? model : (info?.id ?? info?.name);
                if (!id)
                    continue;
                // 思考强度档位：官方只经 resolveModelInfo 公布；未公布即省略该字段
                // （client 侧据此回退到内置档位展示，不会把"未公布"误当成"无档位"）。
                const efforts = await reasoningEffortsOf(llm, String(name), String(id));
                out.push({ provider: String(name), model: String(id), ...(efforts.length > 0 ? { efforts } : {}) });
            }
        }
        catch {
            // 单 provider 失败跳过（与端点语义一致）
        }
    }
    return out;
}
//# sourceMappingURL=ecosystem-directory.js.map