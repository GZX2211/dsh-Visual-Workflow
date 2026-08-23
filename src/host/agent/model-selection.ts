// src/host/agent/model-selection.ts
//
// 节点思考强度（reasoning effort）注入（T-022；V-02 定稿语义）。
//
// 官方取证（需求文档 V-02 + 架构文档 §8 索引 #4、#7）：
//   - 官方 AgentOptions 仅 provider/model/maxTokens（packages/core/agent/src/
//     runtime-types.ts L24-31）——思考强度不在创建选项内；
//   - 官方机制 = ModelSelection + installModelSelection(agentCtx, selection)
//     （packages/core/agent/src/model-selection.ts L10-75）：两条 scoped waterfall
//     （system-prompt/assemble 注入 provider/model 变量；agent/request 改写
//     LlmCallConfig 的 provider/model/reasoningEffort），selection.current 可变，
//     由调用入口持有；
//   - 注入点 = ctx.subagents.registerContinuableSetup((childCtx) => disposer)
//     （activation-setup-registry L26 契约）：每个未发布子代理创建时安装。
//
// 本移植（零官方运行时依赖，W-05）：结构逐条对齐官方 installModelSelection，
// payload/next 全部 unknown 收窄；selection 以 WeakMap 按 childCtx 对象身份登记，
// runner 在 startContinuable 返回后经 agents.get(childId).ctx 找到同一对象并写入
// 节点级 { provider, model, reasoningEffort }——无全局 pending 状态，并发创建
// （协作组并行成员）天然无竞态。子代理复用（签名不变）时 selection 值不变；
// 签名含 provider/model/reasoning，变化即重建，因此 selection 在 child 生命周期
// 内保持字节稳定（KV 前缀友好）。

/** 节点模型选择（官方 ModelSelection 同构；reasoningEffort 取值域以适配器公布为准）。 */
export interface ModelSelectionLike {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 可变选择 + 组装期捕获（官方 ModelSelectionRef 同构）。 */
export interface ModelSelectionRefLike {
  current: ModelSelectionLike | undefined
  assembled: ModelSelectionLike | undefined
}

/** 注入点最小结构（childCtx 形状；与 guards.ts 的 GuardChildContext 同族）。 */
export interface SelectionChildContext {
  on(name: string, listener: (payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown): () => void
}

/**
 * 在 childCtx 上安装模型选择双瀑布监听（官方 installModelSelection 的零依赖移植）。
 * 返回 disposer（官方契约：贡献必须返回该次安装的清理器）。
 */
export function installModelSelectionLike(childCtx: SelectionChildContext, selection: ModelSelectionRefLike): () => void {
  // system-prompt/assemble：组装期把 provider/model 注入提示词变量（官方 L40-53）
  const disposeAssembly = childCtx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
    const assembly = await next()
    const selected = selection.current
    selection.assembled = selected
    if (selected === undefined) return assembly
    const shaped = assembly as { variables?: Record<string, unknown> } | null
    if (!shaped || typeof shaped !== 'object') return assembly
    return {
      ...shaped,
      variables: {
        ...(shaped.variables ?? {}),
        provider: selected.provider,
        model: selected.model,
      },
    }
  }) as () => void

  // agent/request：请求路由改写 provider/model，并写入 reasoningEffort
  // （官方 L54-70：无 effort 时清除继承值，恢复所选模型默认行为）
  const disposeRequest = childCtx.on('agent/request', async (rawPayload, next) => {
    const resolved = (await next()) as Record<string, unknown> | null
    const selected = selection.assembled
    if (selected === undefined) return resolved
    const shaped = resolved && typeof resolved === 'object' ? resolved : {}
    const withoutInherited: Record<string, unknown> = { ...shaped }
    delete withoutInherited.reasoningEffort
    return {
      ...withoutInherited,
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
    }
  }) as () => void

  return () => {
    disposeAssembly()
    disposeRequest()
  }
}

/** 模型选择装配（index.ts 使用：贡献 + 挂接入口）。 */
export interface ModelSelectionSetup {
  /** 经 registerContinuableSetup 注册的贡献（每 child 安装双瀑布 + 登记 selection）。 */
  contribution: (childCtx: unknown) => () => void
  /**
   * 子代理创建完成后由 runner 调用：把节点级选择写入该 child 的 selection。
   * childCtx 以对象身份匹配（contribition 执行时的同一 childCtx = Agent.ctx）。
   */
  attach(childCtx: SelectionChildContext, selection: ModelSelectionLike): void
}

/**
 * 创建模型选择装配：返回贡献与 attach 入口。
 * 为什么 attach 在创建后（而非贡献内取配置）：贡献签名固定 (childCtx) => disposer，
 * 无法携带节点参数；WeakMap 身份匹配让 runner 在拿到 childId → agent.ctx 后写值，
 * 无 pending 状态竞态（并发创建安全）。
 */
export function createModelSelectionSetup(): ModelSelectionSetup {
  const selections = new WeakMap<object, ModelSelectionRefLike>()

  const contribution = (rawChildCtx: unknown): (() => void) => {
    const childCtx = rawChildCtx as SelectionChildContext
    const selection: ModelSelectionRefLike = { current: undefined, assembled: undefined }
    selections.set(childCtx, selection)
    return installModelSelectionLike(childCtx, selection)
  }

  const attach = (childCtx: SelectionChildContext, selection: ModelSelectionLike): void => {
    const ref = selections.get(childCtx)
    if (!ref) return // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
    ref.current = { ...selection }
  }

  return { contribution, attach }
}
