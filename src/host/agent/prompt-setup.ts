// src/host/agent/prompt-setup.ts
//
// 角色 Prompt 段注入 + 官方系统提示词开关
// 背景：官方 system prompt 有缓存/稳定性优化，旧“整段替换/追加”方案已否决。
// 统一语义（父子代理共用）：
// - 角色 Prompt 注册为独立段 `visual-workflow:prompt`(order 1)，会话/回合稳定，KV 缓存友好；不替换官方段，不传 `request.persona`。
// - `injectSystemPrompt`（默认 true，界面“人设段”开关）：ON 正常注入官方身份/人设/系统/上下文段；OFF 清空这些官方段（harness:identity、deployment:persona-*、plan/subagent/sandbox/approval/context/ui/harness:source/app 等及 assembly.contexts、runtime context 快照），仅留角色段+工具相关段。
// - `injectToolSections`（默认 true）：ON 注入 `tool:*` 散文段；OFF 移除全部 `tool:*` 散文段。只重写 assembly.sections/contexts，不动 assembly.tools[]。
// - 工具调用能力只由 tools[] 决定；移除 `tool:*` 散文段仅去掉使用指引。
// - Code Mode 协议段 `tools:sdk`/`tools:ptc-only` 与 tools[] 始终保留；旧 `startsWith('tool:')` 曾误删复数 `tools:*`。
// - 本插件不注册 `tool:*`，唯一注册段为 `visual-workflow:prompt`。
// 注入路径：子代理经宿主在创建窗口内调用 contribution（官方 0.1.2 起无 registerContinuableSetup，
// 撤销归宿主，见同目录 AGENTS.md § 状态所有权）+ AsyncLocalStorage + registerPromptOnCtx 安装；
// 父代理经 bindParent 写根 Agent ctx。零官方运行时依赖。

import { AsyncLocalStorage } from 'node:async_hooks'

/** 角色 Prompt 注册为的系统提示词段名（order 1，位于官方 harness:identity / persona 前缀之后、工具段之前）。 */
export const VISUAL_WORKFLOW_PROMPT_SECTION = 'visual-workflow:prompt'
/**
 * 角色 Prompt 段的 order（有限数字）。
 * 0.1.5-rc.1 官方 order 取证：harness:identity=-1000、deployment:persona-prefix=0、
 * PLAN_POLICY=500、TOOL_* 段 1000~2900、tools:sdk=5000、deployment:persona-suffix=10200。
 * 取 1 → 紧跟官方人设前缀、先于全部策略/工具指引，语义与 0.1.2 时期一致。
 */
const VISUAL_WORKFLOW_PROMPT_ORDER = 1

/** 子代理提示词注入状态（runner 在节点启动后写入；bindParent 也使用）。 */
export interface ChildPromptState {
  /** 节点自定义 System Prompt（角色 Prompt；可为空）。 */
  systemPrompt: string
  /** 官方系统提示词注入开关（默认 true）。 */
  injectSystemPrompt: boolean
  /** 工具提示词（tool:* 散文段）注入开关（默认 true）。 */
  injectToolSections: boolean
}

/** 子代理/父代理提示词注入装配（contribution/withPending/attach/bindParent + 全局瀑布与 pending 读取）。 */
export interface ChildPromptSetup {
  /** 贡献（每个子代理创建时安装角色段与开关过滤瀑布）；由宿主在子代理创建窗口内对 childCtx 调用。 */
  contribution: (childCtx: unknown) => () => void
  /**
   * 在 startContinuable 调用前后夹住节点级状态：作用域内注册的贡献可同步取得
   * 本次创建对应的状态，并立即写入 WeakMap，避免首轮组装竞态。
   */
  withPending<T>(state: ChildPromptState, operation: () => Promise<T>): Promise<T>
  /** 子代理创建完成后由 runner 调用：写入节点级提示词状态（兜底/复用覆盖）。 */
  attach(childCtx: unknown, state: ChildPromptState): void
  /**
   * 把父代理（会话根 Agent）的提示词状态写入其 ctx（运行时直接调用）。
   * 同一 sessionId 只注册一次（此后仅更新可变状态）；注册后的段/过滤对根 Agent 全程生效，
   * 跨会话不影响。非侵入：仅挂载，不修改官方源码。
   */
  bindParent(ctx: unknown, state: ChildPromptState, sessionId: string): void
  /**
   * 注册全局 unscoped `system-prompt/assemble` 瀑布（host 层；与工具开关瀑布同构）：
   * 当 `withPending` 的 AsyncLocalStorage 状态仍在作用域内（即子代理首轮组装发生在
   * `startContinuable` 内部时），据此注入角色 Prompt 段并应用开关过滤——修复「子代理
   * 首轮系统提示词未替换成用户自设角色 Prompt」的 BUG。
   *
   * 为什么需要全局瀑布：子代理首轮组装（`agents.create` 后 `followup` 触发）在
   * `startContinuable` 返回**之前**同步发生（官方 dsh-agent-loop 的 preStep → assemble），
   * 而 per-agent 贡献经 `childSetup` 在 `startContinuable` 返回**之后**才安装，晚于首轮，
   * 导致首轮组装时角色 Prompt 段尚未注册。全局瀑布在 host 初始化时即注册（早于任何
   * 子代理创建），且首轮组装执行在 `withPending` 作用域内，故就近读到 pending 状态注入。
   * 后续回合（pending 已退出）由 per-agent 贡献/bindParent 持久生效，本瀑布不再介入
   * （`pending.getStore()` 为空即原样返回），避免双重注入。
   */
  registerGlobalAssemblyHook(ctx: PromptChildContextLike): () => void
  /**
   * 当前是否处于 `withPending`（视觉工作流子代理创建）作用域内。
   * host 层 `agent/created` 处理器据此判断「正在创建的是视觉工作流子代理」，
   * 从而在其创建窗口内提前安装四类每子代理作用域贡献（角色提示词段 / 工具可见性 deny /
   * 模型选择 / 软截停），使首轮系统提示词与工具集均在第一回合就位（修复「工具第二轮才更新」）。
   */
  hasPending(): boolean
  /** 读取当前 withPending 作用域内的状态（若在作用域内）；`agent/created` 首建时据此取状态。 */
  peekPending(): ChildPromptState | undefined
}

/** 可变状态引用（section 文本以函数读取，attach/bindParent 后即时生效）。 */
interface PromptStateRef {
  systemPrompt: string
  injectSystemPrompt: boolean
  injectToolSections: boolean
}

/** system-prompt/assemble 事件的最小组装形状（零官方类型依赖）。 */
interface PromptAssemblyLike {
  sections?: Array<{ name: string; text: string }>
  contexts?: unknown[]
  tools?: unknown[]
  variables?: Record<string, unknown>
}

/** 子代理/父代理上下文最小结构（on + systemPrompt.section 用于挂瀑布与注册角色段）。 */
interface PromptChildContextLike {
  on(name: string, listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void
  systemPrompt?: { section?(input: { name: string; order: number; text: unknown }): () => void }
}

/**
 * Code Mode 协议段：无论系统提示词/工具段开关如何，都始终保留（移除会破坏 Code Mode 调用协议）。
 *
 * 0.1.5-rc.1 段名取证：官方 dsh-tools 把原 `tools:code-only` 更名为 **`tools:ptc-only`**
 * （dsh-tools/lib/index.js 的 `collapseSection()`，name: "tools:ptc-only"）；`tools:sdk` 未变。
 * 该段承载「本模式下只允许 run_code」这条规则——官方注释明确：若缺失，模型会拿到工具清单
 * 却看不到调用协议，发原生调用后收到 UNKNOWN_TOOL，进而误判部署不一致。
 * 故三名并列恒保留：`tools:ptc-only`（0.1.5+）+ `tools:code-only`（≤0.1.2 旧宿主容忍）。
 */
const CODE_PROTOCOL_SECTIONS = ['tools:sdk', 'tools:ptc-only', 'tools:code-only'] as const

/**
 * 官方身份/人设段：节点设置了自定义 System Prompt（角色 Prompt）时，用角色 Prompt
 * 整体替换这些段（用户裁决「角色 Prompt 替换官方提示词」）。其余官方段
 * （环境上下文/工作区说明等）仍按 injectSystemPrompt 开关决定是否保留。
 *
 * 0.1.5-rc.1 段名取证：官方把原 `deployment:persona` 拆为
 *   - `deployment:persona-prefix`（order 0，第一方指引之前）
 *   - `deployment:persona-suffix`（order 10200，全部第一方指引之后）
 * 且两者文本不同源：
 *   - prefix  = "You are a coding agent powered by the {{model}} model." —— 人设散文；
 *   - suffix  = "Your working directory is {{cwd}}." —— **环境事实**（工作目录）。
 * 用户裁决（2026.09 迁移）：角色 Prompt **只替换 identity + prefix**（接管人设），
 * `deployment:persona-suffix` **不纳入替换列表**——角色 Prompt 生效期间，工作目录
 * 事实仍由官方在提示词末尾提供。suffix 仍受「人设段」开关（injectSystemPrompt）管辖：
 * 开关 OFF 时它与其他官方段一并被清空（两个按钮合起来仍可清空官方全部散文提示词）。
 */
const OFFICIAL_IDENTITY_SECTIONS = ['harness:identity', 'deployment:persona-prefix'] as const

/** 是否为 Code Mode 协议段（tools:sdk / tools:ptc-only / 旧名 tools:code-only；复数命名且以 `tools:` 开头）。 */
function isCodeProtocolSection(name: string): boolean {
  return CODE_PROTOCOL_SECTIONS.includes(name as (typeof CODE_PROTOCOL_SECTIONS)[number])
}

/** 是否为工具使用指引散文段（单数命名，`tool:` 开头；不含复数的 tools:* 协议段）。 */
function isToolProseSection(name: string): boolean {
  return name.startsWith('tool:')
}

/** 是否为官方身份/人设段（角色 Prompt 设置时被整体替换）。 */
function isOfficialIdentitySection(name: string): boolean {
  return OFFICIAL_IDENTITY_SECTIONS.includes(name as (typeof OFFICIAL_IDENTITY_SECTIONS)[number])
}

/**
 * 是否保留某个段：角色段与 Code 协议段恒保留；tool:* 段按 injectToolSections；
 * 角色 Prompt 设置时官方身份段（harness:identity + deployment:persona-prefix）被替换（不保留）；
 * 其余官方段（含 deployment:persona-suffix）按 injectSystemPrompt。
 */
function shouldKeepSection(name: string, ref: PromptStateRef): boolean {
  if (name === VISUAL_WORKFLOW_PROMPT_SECTION) return true // 角色 Prompt 段始终保留
  if (isCodeProtocolSection(name)) return true // Code Mode 协议段始终保留
  if (isToolProseSection(name)) return ref.injectToolSections // 工具散文段按工具开关
  // 角色 Prompt 设置时替换官方身份/人设段（不再注入官方 identity/persona）
  if (isOfficialIdentitySection(name) && String(ref.systemPrompt ?? '').trim()) return false
  return ref.injectSystemPrompt // 其余官方段（人设/身份/系统）按系统提示词开关
}

/**
 * 把角色 Prompt 状态应用到一次系统提示词组装结果（纯函数、确定性）：
 *   - 两开关全开且未设置角色 Prompt 时原样返回（保持官方缓存/稳定性优化）；
 *   - 否则注入 `visual-workflow:prompt` 段（sectionRegistered 为 false 时在瀑布内补插），
 *     再按 shouldKeepSection 过滤出保留段；contexts 随 injectSystemPrompt 开关。
 * 供 per-agent 贡献/父代理 bindParent 与全局首轮瀑布共用，逻辑一致。
 */
function applyPromptStateToAssembly(
  assembly: PromptAssemblyLike | null,
  ref: PromptStateRef,
  sectionRegistered: boolean,
): PromptAssemblyLike | null {
  if (!assembly) return assembly
  const roleText = String(ref.systemPrompt ?? '').trim()
  const roleSet = roleText.length > 0
  // 快速路径：两开关全开且未设置角色 Prompt（无需替换官方身份段）时，不改动官方组装。
  const needsFilter = !(ref.injectSystemPrompt && ref.injectToolSections) || roleSet
  if (!needsFilter) return assembly
  let baseSections = Array.isArray(assembly.sections) ? [...assembly.sections] : []
  if (!sectionRegistered && roleSet) {
    // 避免重复注入：若组装结果已含角色 Prompt 段（例如 per-agent 的 sys.section 已注册、
    // 或本次瀑布已在前次监听中补插过），不再重复追加。
    const alreadyPresent = baseSections.some((section) => String(section.name) === VISUAL_WORKFLOW_PROMPT_SECTION)
    if (!alreadyPresent) {
      baseSections = [{ name: VISUAL_WORKFLOW_PROMPT_SECTION, text: roleText }, ...baseSections]
    }
  }
  const sections = baseSections.filter((section) => shouldKeepSection(String(section.name), ref))
  return { ...assembly, sections, contexts: ref.injectSystemPrompt ? (assembly.contexts ?? []) : [] }
}

/**
 * 在同一 ctx 上装配「角色 Prompt 段 + 开关过滤瀑布」，返回合并 disposer。
 * 供子代理 contribution 与父代理 bindParent 共用（逻辑一致）。
 */
function registerPromptOnCtx(childCtx: PromptChildContextLike, ref: PromptStateRef): () => void {
  const disposers: Array<() => void> = []

  // 官方 systemPrompt.section API 可用：把角色 Prompt 注册为独立命名段（注入一次）
  let sectionRegistered = false
  const sys = childCtx.systemPrompt
  if (typeof sys?.section === 'function') {
    try {
      const disposer = sys.section({
        name: VISUAL_WORKFLOW_PROMPT_SECTION,
        order: VISUAL_WORKFLOW_PROMPT_ORDER,
        text: () => ref.systemPrompt,
      })
      sectionRegistered = true
      if (typeof disposer === 'function') disposers.push(disposer)
    } catch {
      // section 注册失败（如顺序冲突）：降级为瀑布兜底注入（见下面分支）
      sectionRegistered = false
    }
  }

  // 开关过滤瀑布：两开关全开且未设置角色 Prompt 时返回官方原有装配（不改动，保持官方
  // 缓存/稳定性优化）；否则按 applyPromptStateToAssembly 保留角色段 + Code 协议段 + 按开关的
  // 工具段/官方段。角色 Prompt 设置时会替换官方身份/人设段（用户裁决）。
  // 工具调用能力仅由 tools[] Schema 决定，本瀑布从不改动 assembly.tools。
  const disposeAssembly = childCtx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
    const assembly = (await next()) as PromptAssemblyLike | null
    return applyPromptStateToAssembly(assembly, ref, sectionRegistered)
  }) as () => void
  disposers.push(disposeAssembly)

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 撤销尽力而为
      }
    }
  }
}

/**
 * 创建子代理/父代理提示词注入装配。
 *
 * @returns contribution（每 child 装配）/ withPending（创建窗口状态作用域）/
 *          attach（创建后按 childCtx 写入状态）/ bindParent（父代理按会话绑定）/
 *          registerGlobalAssemblyHook（宿主 unscoped 首轮瀑布）/ hasPending / peekPending。
 */
export function createChildPromptSetup(): ChildPromptSetup {
  const states = new WeakMap<object, PromptStateRef>()
  const pending = new AsyncLocalStorage<ChildPromptState>()

  // 父代理（根 Agent）按 sessionId 的绑定表：每会话只注册一次，更新走可变状态。
  // 【释放路径】监听器注册在根 Agent 的 ctx 上，随该 ctx 的 fiber 卸载自动移除；
  // 本表只保留调用入口引用，随宿主实例一起回收（宿主持有本装配对象，不单独释放）。
  const parentRefs = new Map<string, PromptStateRef>()
  const parentDisposers = new Map<string, () => void>()

  const contribution = (rawChildCtx: unknown): (() => void) => {
    const childCtx = rawChildCtx as PromptChildContextLike
    if (typeof childCtx?.on !== 'function') return () => {}

    // 创建窗口内若存在 pending 状态，立即落 WeakMap（首轮组装前保证就绪）
    const pendingState = pending.getStore()
    const ref: PromptStateRef = {
      systemPrompt: pendingState ? String(pendingState.systemPrompt ?? '') : '',
      injectSystemPrompt: pendingState ? pendingState.injectSystemPrompt !== false : true,
      injectToolSections: pendingState ? pendingState.injectToolSections !== false : true,
    }
    states.set(childCtx as object, ref)

    return registerPromptOnCtx(childCtx, ref)
  }

  const withPending = <T>(state: ChildPromptState, operation: () => Promise<T>): Promise<T> =>
    pending.run(state, operation)

  const hasPending = (): boolean => pending.getStore() !== undefined

  const peekPending = (): ChildPromptState | undefined => pending.getStore()

  const attach = (childCtx: unknown, state: ChildPromptState): void => {
    if (!childCtx || typeof childCtx !== 'object') return
    const ref = states.get(childCtx as object)
    if (!ref) return // 该 child 未走本贡献（如非延续子代理/其他 provider）：静默忽略
    ref.systemPrompt = String(state.systemPrompt ?? '')
    ref.injectSystemPrompt = state.injectSystemPrompt !== false
    ref.injectToolSections = state.injectToolSections !== false
  }

  const bindParent = (ctx: unknown, state: ChildPromptState, sessionId: string): void => {
    if (!ctx || typeof ctx !== 'object') return
    let ref = parentRefs.get(sessionId)
    if (!ref) {
      ref = {
        systemPrompt: String(state.systemPrompt ?? ''),
        injectSystemPrompt: state.injectSystemPrompt !== false,
        injectToolSections: state.injectToolSections !== false,
      }
      parentRefs.set(sessionId, ref)
      parentDisposers.set(sessionId, registerPromptOnCtx(ctx as PromptChildContextLike, ref))
    }
    ref.systemPrompt = String(state.systemPrompt ?? '')
    ref.injectSystemPrompt = state.injectSystemPrompt !== false
    ref.injectToolSections = state.injectToolSections !== false
  }

  /**
   * 全局 unscoped 瀑布（host 层，与工具开关瀑布同构）。宿主在初始化时注册到自身
   * unscoped ctx，对所有 agent 的组装生效。子代理首轮组装发生在 `withPending` 作用域内
   * （startContinuable 尚未返回），此时 pending.getStore() 非空——据此注入角色 Prompt 段
   * 并应用开关过滤，使首轮即用角色 Prompt 替换官方身份/人设段。后续回合 pending 已退出，
   * 本瀑布原样返回（由 per-agent 贡献/bindParent 持久生效），避免双重注入。
   */
  const registerGlobalAssemblyHook = (ctx: PromptChildContextLike): (() => void) => {
    if (typeof ctx?.on !== 'function') return () => {}
    return ctx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
      const assembly = (await next()) as PromptAssemblyLike | null
      const pendingState = pending.getStore()
      if (!pendingState) return assembly // 非视觉工作流子代理首轮/后续回合：交给 per-agent 贡献/bindParent
      return applyPromptStateToAssembly(assembly, {
        systemPrompt: String(pendingState.systemPrompt ?? ''),
        injectSystemPrompt: pendingState.injectSystemPrompt !== false,
        injectToolSections: pendingState.injectToolSections !== false,
      }, false)
    }) as () => void
  }

  return { contribution, withPending, attach, bindParent, registerGlobalAssemblyHook, hasPending, peekPending }
}
