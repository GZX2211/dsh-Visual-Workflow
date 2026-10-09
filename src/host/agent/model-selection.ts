// src/host/agent/model-selection.ts
//
// 节点思考强度（reasoning effort）注入。
//
// 官方取证：
//   - 官方机制 = ModelSelection + installModelSelection(agentCtx, selection)
//     （packages/core/agent/src/model-selection.ts L10-75）：两条 scoped waterfall
//     （system-prompt/assemble 注入 provider/model 变量；agent/request 改写
//     LlmCallConfig 的 provider/model/reasoningEffort），selection.current 可变，
//     由调用入口持有；
//
// 本移植：结构逐条对齐官方 installModelSelection 的双瀑布与可变 selection 语义，
// payload/next 全部 unknown 收窄；selection 以 WeakMap 按 childCtx 对象身份登记，
// runner 在 startContinuable 返回后经 agents.get(childId).ctx 找到同一对象并写入
// 节点级 { provider, model, reasoningEffort }——无全局 pending 状态
//
// 【与官方的已知差异（取证：dsh-agent/lib/types/model-selection.d.ts L23-41）】该版本官方
// installModelSelection 在 provider/model **变化**时还会向下一次被受理的请求追加以
// user 角色写入的持久化告知（durable notice），effort 单变与空决策不写。本平台按
// 「节点子代理的 provider/model 在创建时确定、运行中不切换」使用该能力，故未移植告知线；
// 若将来允许节点级运行中切换模型，必须补齐该行为并同步测试（见同目录 AGENTS.md § 依赖边界）。

import { AsyncLocalStorage } from 'node:async_hooks'

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
  /** 贡献（每 child 安装双瀑布 + 登记 selection）；由宿主在子代理创建窗口内对 childCtx 调用。 */
  contribution: (childCtx: unknown) => () => void
  /**
   * 子代理创建完成后由 runner 调用：把节点级选择写入该 child 的 selection。
   * childCtx 以对象身份匹配（contribution 执行时的同一 childCtx = Agent.ctx）。
   */
  attach(childCtx: SelectionChildContext, selection: ModelSelectionLike): void
  /**
   * 在创建窗口内夹住一段「本次创建应有的模型选择」。
   *
   * 为什么需要：selection 默认在创建完成后才写入，而创建即开始首轮推理——首条请求会落到
   * 创建时的路由（父代理的 provider/model）。对无法经官方创建参数携带路由的子代理
   * （协作组成员由官方 Team 服务建立，不接受 agentOptions），必须在创建窗口内就让
   * selection 就位，否则首个步骤用错模型。非该场景无需使用本方法。
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
   * 同一 sessionId 只注册一次（此后仅更新 selection.current）；
   * 服务商/模型/思考强度在会话内可调（官方 ModelSelection 语义），非侵入仅挂载。
   */
  bindParent(ctx: unknown, selection: ModelSelectionLike, sessionId: string): void
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
  // 本表只保留调用入口引用，随宿主实例一起回收（宿主持有本装配对象，不单独释放）。
  const parentRefs = new Map<string, ModelSelectionRefLike>()
  const parentDisposers = new Map<string, () => void>()

  const contribution = (rawChildCtx: unknown): (() => void) => {
    const childCtx = rawChildCtx as SelectionChildContext
    const pendingSelection = pending.getStore()
    const selection: ModelSelectionRefLike = {
      current: pendingSelection ? { ...pendingSelection } : undefined,
      assembled: undefined,
    }
    selections.set(childCtx, selection)
    return installModelSelectionLike(childCtx, selection)
  }

  const attach = (childCtx: SelectionChildContext, selection: ModelSelectionLike): void => {
    const ref = selections.get(childCtx)
    if (!ref) return // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
    ref.current = { ...selection }
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

  const bindParent = (ctx: unknown, selection: ModelSelectionLike, sessionId: string): void => {
    if (!ctx || typeof ctx !== 'object') return
    let ref = parentRefs.get(sessionId)
    if (!ref) {
      ref = { current: undefined, assembled: undefined }
      parentRefs.set(sessionId, ref)
      parentDisposers.set(sessionId, installModelSelectionLike(ctx as SelectionChildContext, ref))
    }
    ref.current = { ...selection }
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

  return { contribution, attach, withPending, remember, restore, bindParent, modelOf, parentModelOf }
}
