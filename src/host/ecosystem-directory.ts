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

/** 官方 agentPreset 条目的稳定投影（字段保留原值，由调用方按需收敛；broken 项已剔除）。 */
export interface AgentPresetEntry {
  id: unknown
  name: unknown
  description: unknown
  /**
   * 官方 0.1.7-rc.1 **已不发布**该字段（dsh-agent-preset-registry/lib/types/preset.d.ts
   * L4-10 只有 id/name/description/order/broken）。保留为兼容占位，恒为 `'user'`；
   * client 侧 `PresetItem.trust?` 为可选，不消费其取值。
   */
  trust: unknown
}

/** 官方模型条目的稳定投影（efforts 为思考强度档位；官方未公布时省略）。 */
export interface ModelEntry {
  provider: string
  model: string
  efforts?: Array<{ id: string; name: string }>
}

/** 仅需 ctx.get 的最小宿主缝（GUI 端点基座与 Service 均满足）。 */
interface CtxLike {
  get(name: string): unknown
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
export async function listAgentPresets(ctx: CtxLike): Promise<AgentPresetEntry[] | null> {
  const agentPresets = ctx.get('agentPresets') as { list?: () => Promise<unknown[]> } | null | undefined
  if (!agentPresets || typeof agentPresets.list !== 'function') return null
  const items = (await agentPresets.list()) ?? []
  return items
    .filter((item) => (item as { broken?: unknown }).broken === undefined)
    .map((item) => {
      const entry = item as {
        id?: unknown
        name?: unknown
        description?: unknown
        trust?: unknown
        metadata?: { name?: unknown; description?: unknown }
      }
      return {
        id: entry.id,
        name: entry.name ?? entry.metadata?.name ?? entry.id,
        description: entry.description ?? entry.metadata?.description ?? '',
        trust: entry.trust ?? 'user',
      }
    })
}

/**
 * 可选模型清单（llm 服务或 listModels 缺失返回空数组；单 provider 失败跳过）。
 * provider 标识按 id → name 回退解析（只有 name 的条目不再被静默丢弃）。
 */
export async function listEcosystemModels(ctx: CtxLike): Promise<ModelEntry[]> {
  const llm = ctx.get('llm') as
    | { listProviders?: () => unknown[]; listModels?: (provider: string) => Promise<unknown[]> }
    | null
    | undefined
  if (!llm || typeof llm.listProviders !== 'function') return []
  let providers: unknown[] = []
  try {
    providers = llm.listProviders() ?? []
  } catch {
    providers = []
  }
  const out: ModelEntry[] = []
  for (const entry of providers) {
    const name =
      typeof entry === 'string' ? entry : ((entry as { id?: unknown; name?: unknown })?.id ?? (entry as { name?: unknown })?.name)
    if (!name) continue
    if (typeof llm.listModels !== 'function') continue
    try {
      const models = (await llm.listModels(String(name))) ?? []
      for (const model of models ?? []) {
        const info = typeof model === 'string' ? null : (model as { id?: unknown; name?: unknown; efforts?: Array<{ id?: unknown; name?: unknown }> })
        const id = typeof model === 'string' ? model : (info?.id ?? info?.name)
        if (!id) continue
        // 思考强度档位：适配器公布时透传（V-02）；未公布则省略（client 回退内置档位）
        const efforts = Array.isArray(info?.efforts)
          ? info.efforts
              .map((effort) => ({ id: String(effort.id ?? ''), name: String(effort.name ?? effort.id ?? '') }))
              .filter((effort) => effort.id)
          : undefined
        out.push({ provider: String(name), model: String(id), ...(efforts ? { efforts } : {}) })
      }
    } catch {
      // 单 provider 失败跳过（与端点语义一致）
    }
  }
  return out
}
