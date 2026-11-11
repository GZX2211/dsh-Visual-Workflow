// src/host/agent/model-selection.ts
//
// 节点思考强度（reasoning effort）与模型路由注入。
//
// 官方契约（0.2.2-rc.1 取证，packages/core/agent-loop/src/prepareRequest）：
//   步进准备（agent/pre-step）先从 agent.model.current() 固化本次 selection，随后主循环
//   派发 agent/request 瀑布；两者 provider/model/reasoningEffort 必须完全一致，否则主循环
//   抛 "agent/request proposed … after step preparation fixed …; use agent.model.select()
//   before step preparation"。因此路由与强度只能在步进准备前经 AgentOptions 或
//   agent.model.select() 写入，不能在 agent/request 阶段改写。
//
// 两条通道：
//   - 0.2.2+（Agent 暴露 model.select）：节点选择经 applyTo 提交官方 AgentModel，
//     首步与后续步都由官方步进固化；本装配只留存选择供 modelOf 查询与冷恢复重装；
//   - ≤0.2.1（无 AgentModel）：保留官方旧版 installModelSelection 移植（assemble 注入
//     provider/model 变量 + agent/request 改写路由），该核没有步进一致性强校验。
//
// selection 以 WeakMap 按 childCtx 对象身份登记，runner/host 拿到 agent.ctx 后写值，
// 无全局 pending 状态。

import { AsyncLocalStorage } from 'node:async_hooks'

/** 节点模型选择（官方 ModelSelection 同构；reasoningEffort 取值域以适配器公布为准）。 */
export interface ModelSelectionLike {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 可变选择 + 组装期捕获（官方旧版 ModelSelectionRef 同构；assembled 只被旧核瀑布使用）。 */
export interface ModelSelectionRefLike {
  current: ModelSelectionLike | undefined
  assembled: ModelSelectionLike | undefined
}

/** 注入点最小结构（childCtx 形状；与 guards.ts 的 GuardChildContext 同族）。 */
export interface SelectionChildContext {
  on(name: string, listener: (payload: unknown, ...next: Array<() => Promise<unknown>>) => unknown): () => void
}

/**
 * 官方 Agent 模型选择面（0.2.2+ 的 AgentModel；旧核没有该字段）。
 * current() 是步进准备将固化的选择；select() 是官方错误信息要求的唯一改选通道。
 * 全部可选：形状漂移时按旧核瀑布降级，不因未知字段抛错。
 */
export interface SelectionAgentModelLike {
  current?: () => ModelSelectionLike | undefined
  select?: (selection: ModelSelectionLike) => void
}

/** Agent 最小形状（ctx 用于身份匹配；model 为 0.2.2+ 的官方选择面）。 */
export interface SelectionAgentLike {
  ctx?: unknown
  model?: SelectionAgentModelLike
}

/** 节点配置的模型/强度字段（空白 = 未配置）。 */
export interface NodeModelConfig {
  provider?: unknown
  model?: unknown
  reasoning?: unknown
}

/**
 * 官方 Agent 模型选择面的运行时守卫。
 * 返回 null 表示旧核（或形状漂移）：调用方退回旧版 agent/request 瀑布。
 */
function officialModelOf(rawAgent: unknown): SelectionAgentModelLike | null {
  if (rawAgent === null || typeof rawAgent !== 'object') return null
  const model = (rawAgent as { model?: unknown }).model
  if (model === null || typeof model !== 'object') return null
  return model as SelectionAgentModelLike
}

/** 完整 selection 守卫：provider/model 都非空才可作为官方选择提交。 */
function completeSelectionOf(selection: ModelSelectionLike | null | undefined): ModelSelectionLike | null {
  if (!selection) return null
  const provider = String(selection.provider ?? '').trim()
  const model = String(selection.model ?? '').trim()
  if (!provider || !model) return null
  const reasoning = String(selection.reasoningEffort ?? '').trim()
  return reasoning ? { provider, model, reasoningEffort: reasoning } : { provider, model }
}

/**
 * 由节点配置与官方当前路由合成一次模型选择（纯函数）。
 *
 * 语义与节点面板「留空 = 默认」一致：
 *   - provider+model 都配置：按节点路由选择；reasoning 留空时省略 effort，即恢复所选
 *     模型的默认强度（agent.model.select 会清除继承的父级 effort）；
 *   - 只配置 reasoning：沿用官方当前路由（父代理继承或创建时 AgentOptions），只改强度；
 *   - 其余（全空 / 路由不完整且无强度）：返回 null，保持官方继承路由不动。
 */
export function composeNodeSelection(
  config: NodeModelConfig,
  current: ModelSelectionLike | null,
): ModelSelectionLike | null {
  const provider = String(config.provider ?? '').trim()
  const model = String(config.model ?? '').trim()
  const reasoning = String(config.reasoning ?? '').trim()
  if (provider && model) {
    return reasoning ? { provider, model, reasoningEffort: reasoning } : { provider, model }
  }
  if (!reasoning) return null
  const inherited = completeSelectionOf(current)
  if (!inherited) return null
  return { provider: inherited.provider, model: inherited.model, reasoningEffort: reasoning }
}

/**
 * 在 childCtx 上安装模型选择双瀑布监听（官方旧版 installModelSelection 的零依赖移植；
 * 仅 0.2.1 及以前使用——0.2.2+ 由 contribution 判定后不安装，改走 agent.model.select）。
 * 返回 disposer（官方契约：贡献必须返回该次安装的清理器）。
 */
export function installModelSelectionLike(childCtx: SelectionChildContext, selection: ModelSelectionRefLike): () => void {
  // system-prompt/assemble：组装期把 provider/model 注入提示词变量（官方 L40-53）
  const disposeAssembly = childCtx.on('system-prompt/assemble', async (_rawAssembly, _rawContext, next) => {
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
  // （官方旧版 L54-70：无 effort 时清除继承值，恢复所选模型默认行为）
  const disposeRequest = childCtx.on('agent/request', async (_rawPayload, next) => {
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
  /**
   * 贡献（每 child 安装作用域监听 + 登记 selection）；由宿主在子代理创建窗口内对 childCtx 调用。
   * `agent` 用于判定官方选择面：0.2.2+ 不安装 agent/request 改写（会与步进固化冲突），
   * 旧核仍安装双瀑布。缺省按旧核处理。
   */
  contribution: (childCtx: unknown, agent?: unknown) => () => void
  /**
   * 子代理创建完成后由 runner/host 调用：把节点级选择写入该 child 的 selection 留存。
   * childCtx 以对象身份匹配（contribution 执行时的同一 childCtx = Agent.ctx）。
   */
  attach(childCtx: SelectionChildContext, selection: ModelSelectionLike): void
  /**
   * 把选择提交给官方 Agent（`agent.model.select()`），必须在下一步步进准备前调用。
   *
   * 显式传入 selection 时同步写入本装配留存（供 modelOf / 冷恢复重装）；缺省用已留存值。
   * 返回是否真正提交：旧核无 model.select 时返回 false，调用方沿用旧版 agent/request 瀑布。
   * 官方 select 抛错时向上传播，由调用方按各自审计口径处理（不得静默篡改选择）。
   */
  applyTo(agent: unknown, selection?: ModelSelectionLike): boolean
  /** 读官方 Agent 当前选择（步进准备将固化的值）；旧核或形状不符返回 null。 */
  currentOf(agent: unknown): ModelSelectionLike | null
  /**
   * 在创建窗口内夹住一段「本次创建应有的模型选择」。
   *
   * 为什么需要：对无法经官方创建参数携带路由的子代理（Team 成员由官方 Team 服务建立，
   * 不接受 agentOptions），必须在创建窗口内就让 selection 就位；否则首个步骤用错模型。
   * 新核由宿主在 `agent/created` 内 applyTo 提交官方 AgentModel，旧核由贡献瀑布接管。
   */
  withPending<T>(selection: ModelSelectionLike | undefined, operation: () => Promise<T>): Promise<T>
  /**
   * 按 childId 记住该子代理的模型选择。
   *
   * 两处消费：重发布（冷恢复）时重装（restore），以及按身份查询当前模型（modelOf）——
   * 因为「可延续子代理在回合间会被销毁并冷恢复」，创建窗口内写进 ctx 的 selection 会丢失，
   * 冷恢复时官方不接受成员级路由，故选择必须由本模块留存。
   */
  remember(childId: string, selection: ModelSelectionLike): void
  /**
   * 重发布时按 childId 重装已记住的选择（宿主在 `agent/created` 调用；无记录则不做任何事）。
   */
  restore(childId: string, childCtx: unknown): void
  /**
   * 把父代理（会话根 Agent）的模型选择写入其 ctx（运行时直接调用）。
   * 同一 sessionId 只注册一次（此后仅更新 selection.current）；新核同时经 `agent`
   * 参数提交官方 AgentModel，旧核由旧版瀑布在请求阶段生效。
   */
  bindParent(ctx: unknown, selection: ModelSelectionLike, sessionId: string, agent?: unknown): void
  /**
   * 按子代理身份查询当前模型选择（无记录返回 null）。
   *
   * 为什么需要查询入口：模型路由只在本装配内成为事实，消费方（如经验评价记录评分者模型）
   * 只能经此读取，各自推断必然与实际路由漂移。「无记录」返回 null 而不是空对象，
   * 让消费方自己决定空值语义（记录空串 = 有事实但值为空）。
   */
  modelOf(childId: string): ModelSelectionLike | null
  /** 按会话查询父代理当前模型选择（未绑定返回 null）。 */
  parentModelOf(sessionId: string): ModelSelectionLike | null
}

/**
 * 创建模型选择装配：返回贡献与 attach 入口。
 * 为什么 attach 在创建后（而非贡献内取配置）：贡献签名固定 (childCtx) => disposer，
 * 无法携带节点参数；WeakMap 身份匹配让 runner 在拿到 childId → agent.ctx 后写值，
 * 无 pending 状态竞态（并发创建安全）。
 */
export function createModelSelectionSetup(): ModelSelectionSetup {
  const selections = new WeakMap<object, ModelSelectionRefLike>()
  /** 创建窗口内的选择（仅在该窗口内可见；按 childId 的留存表见 remembered）。 */
  const pending = new AsyncLocalStorage<ModelSelectionLike | undefined>()
  /**
   * childId → 已记住的模型选择（重发布重装用）。
   * 【释放路径】条目与子代理身份绑定，只增不减；内容为两个短字符串，随宿主持有的本装配
   * 对象一起回收（宿主 dispose 后无引用）。childId 全局唯一，故不按会话再分表。
   */
  const remembered = new Map<string, ModelSelectionLike>()

  // 父代理（根 Agent）按 sessionId 的绑定表：每会话只注册一次，更新走 selection.current。
  // 【释放路径】监听器注册在根 Agent 的 ctx 上，随该 ctx 的 fiber 卸载自动移除；
  // 本表只保留装配期的状态引用，随宿主实例一起回收（宿主持有本装配对象，不单独释放）。
  const parentRefs = new Map<string, ModelSelectionRefLike>()

  const contribution = (rawChildCtx: unknown, rawAgent?: unknown): (() => void) => {
    const childCtx = rawChildCtx as SelectionChildContext
    const pendingSelection = pending.getStore()
    const selection: ModelSelectionRefLike = {
      current: pendingSelection ? { ...pendingSelection } : undefined,
      assembled: undefined,
    }
    selections.set(childCtx, selection)
    // 0.2.2+：官方 AgentModel 在步进准备阶段固化选择；此时再在 agent/request 改写路由
    // 会被主循环断言拒绝（本 Issue 的崩溃点），故只登记留存、不安装请求瀑布。
    const official = officialModelOf(rawAgent)
    if (official !== null && typeof official.select === 'function') return () => {}
    return installModelSelectionLike(childCtx, selection)
  }

  const attach = (childCtx: SelectionChildContext, selection: ModelSelectionLike): void => {
    const ref = selections.get(childCtx)
    if (!ref) return // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
    ref.current = { ...selection }
  }

  const currentOf = (rawAgent: unknown): ModelSelectionLike | null => {
    const official = officialModelOf(rawAgent)
    if (official === null || typeof official.current !== 'function') return null
    try {
      return completeSelectionOf(official.current())
    } catch {
      // 官方形状漂移：按「无法读取」处理，调用方退回节点配置/继承路由
      return null
    }
  }

  const applyTo = (rawAgent: unknown, selection?: ModelSelectionLike): boolean => {
    const rawCtx = rawAgent !== null && typeof rawAgent === 'object' ? (rawAgent as SelectionAgentLike).ctx : undefined
    const ref = rawCtx !== null && typeof rawCtx === 'object' ? selections.get(rawCtx) : undefined
    if (selection !== undefined && ref) ref.current = { ...selection }
    const chosen = selection ?? ref?.current
    const complete = completeSelectionOf(chosen)
    if (!complete) return false
    const official = officialModelOf(rawAgent)
    if (official === null || typeof official.select !== 'function') return false
    official.select(complete)
    return true
  }

  const withPending = <T>(selection: ModelSelectionLike | undefined, operation: () => Promise<T>): Promise<T> =>
    pending.run(selection, operation)

  const remember = (childId: string, selection: ModelSelectionLike): void => {
    const id = String(childId ?? '')
    if (!id) return
    remembered.set(id, { ...selection })
  }

  const restore = (childId: string, childCtx: unknown): void => {
    const selection = remembered.get(String(childId ?? ''))
    if (!selection) return
    if (childCtx === null || typeof childCtx !== 'object') return
    const ref = selections.get(childCtx)
    if (!ref) return // 该 child 未走本贡献：无 selection 可写，静默跳过
    ref.current = { ...selection }
  }

  const bindParent = (ctx: unknown, selection: ModelSelectionLike, sessionId: string, rawAgent?: unknown): void => {
    if (!ctx || typeof ctx !== 'object') return
    const official = officialModelOf(rawAgent)
    const hasOfficialSelect = official !== null && typeof official.select === 'function'
    let ref = parentRefs.get(sessionId)
    if (!ref) {
      ref = { current: undefined, assembled: undefined }
      parentRefs.set(sessionId, ref)
      // 新核已由官方 AgentModel 接管路由；继续装旧版请求改写会与步进固化冲突。
      if (!hasOfficialSelect) installModelSelectionLike(ctx as SelectionChildContext, ref)
    }
    ref.current = { ...selection }
    if (official !== null && typeof official.select === 'function') {
      // 父代理同样只能经官方通道改选：节点路由完整时以节点为准，仅配置强度时沿用当前路由
      const complete = completeSelectionOf(ref.current) ?? composeNodeSelection(ref.current, currentOf(rawAgent))
      if (complete) official.select(complete)
    }
  }

  const parentModelOf = (sessionId: string): ModelSelectionLike | null => {
    const id = String(sessionId ?? '')
    if (!id) return null
    const ref = parentRefs.get(id)
    // 返回副本：查询方不得就地改写本装配持有的选择引用
    return ref?.current ? { ...ref.current } : null
  }

  const modelOf = (childId: string): ModelSelectionLike | null => {
    const id = String(childId ?? '')
    if (!id) return null
    const selection = remembered.get(id)
    return selection ? { ...selection } : null
  }

  return { contribution, attach, applyTo, currentOf, withPending, remember, restore, bindParent, modelOf, parentModelOf }
}
