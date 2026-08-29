// src/host/agent/prompt-setup.ts
//
// 角色 Prompt 系统提示词段注入 + 官方系统提示词开关（T-021 配套，需求变更后重写）。
//
// 背景：此前实现把节点自定义 System Prompt 作为「完整系统提示词」注入，整段替换/追加
//       官方 system prompt（含 Code Mode 保留官方工具调用提示词）。该方案被否决：
//       官方已对系统提示词做缓存/稳定性优化，插件不应随意插入或替换官方段。
//
// 统一语义（子代理与父代理共用）：
//   - 角色 Prompt（节点自定义 System Prompt）注册为**独立命名段** `visual-workflow:prompt`
//     （order 1），注入一次、会话/回合间稳定不变（KV 缓存前缀友好）；
//   - **不再整段替换/插入**官方 system prompt，也**不再传** `request.persona` 占用官方人设；
//   - 开关一 `injectSystemPrompt`（默认 true）：ON（开）= harness:identity / 人设 /
//     系统 / 上下文段正常注入；OFF（关）= 清空这些官方段（仅保留角色段 + 工具相关段）。
//   - 开关二 `injectToolSections`（默认 true）：ON（开）= 各工具包注册的 `tool:*` 散文段
//     正常注入；OFF（关）= 移除所有 `tool:*` 散文段。
//   - **无论两个开关如何组合，Code Mode 协议段 `tools:sdk` / `tools:code-only` 与
//     tools[] 工具 Schema 都**始终保留**：前者是 Code Mode 的调用协议声明（旧实现用
//     `startsWith('tool:')` 误用了单数匹配，把复数的 `tools:*` 一并清掉，属操作失误）；
//     后者决定工具是否可被调用，与散文段注入无关。
//   - 工具能否被调用**只由 tools[] Schema 决定**；移除 `tool:*` 散文段仅去掉使用指引，
//     不改变调用能力。
//
// 两类 Agent 的注入路径：
//   - 子代理：经 registerContinuableSetup 的 contribution（创建窗口读取 withPending 状态，
//     经 AsyncLocalStorage 隔离并发创建），resolvePromptOnCtx 装配；
//   - 父代理（会话根 Agent）：经 bindParent 把节点级状态写入根 Agent 的 ctx（运行时直接
//     调用，官方 `agents.get(sessionId)?.ctx` 可达；非侵入，仅挂载而不改源码）。
//
// 零官方运行时依赖：section() 与 on('system-prompt/assemble') 均以最小结构守卫收窄。

import { AsyncLocalStorage } from 'node:async_hooks'

/** 角色 Prompt 注册为的系统提示词段名（order 1，位于官方 harness:identity 之后、工具段之前）。 */
export const VISUAL_WORKFLOW_PROMPT_SECTION = 'visual-workflow:prompt'
/** 角色 Prompt 段的 order（有限数字；官方 harness:identity=-100、部署 persona=0）。 */
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

/** 子代理/父代理提示词注入装配（contribution/attach/bindParent 三段式 + 创建期 withPending）。 */
export interface ChildPromptSetup {
  /** 经 registerContinuableSetup 注册的贡献（每个子代理创建时安装监听）。 */
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

/** Code Mode 协议段：无论系统提示词/工具段开关如何，都始终保留（移除会破坏 Code Mode 调用协议）。 */
const CODE_PROTOCOL_SECTIONS = ['tools:sdk', 'tools:code-only'] as const

/** 是否为 Code Mode 协议段（tools:sdk / tools:code-only；复数命名且以 `tools:` 开头）。 */
function isCodeProtocolSection(name: string): boolean {
  return CODE_PROTOCOL_SECTIONS.includes(name as (typeof CODE_PROTOCOL_SECTIONS)[number])
}

/** 是否为工具使用指引散文段（单数命名，`tool:` 开头；不含复数的 tools:* 协议段）。 */
function isToolProseSection(name: string): boolean {
  return name.startsWith('tool:')
}

/** 是否保留某个段：角色段与 Code 协议段恒保留；tool:* 段按 injectToolSections；其余官方段按 injectSystemPrompt。 */
function shouldKeepSection(name: string, ref: PromptStateRef): boolean {
  if (name === VISUAL_WORKFLOW_PROMPT_SECTION) return true // 角色 Prompt 段始终保留
  if (isCodeProtocolSection(name)) return true // Code Mode 协议段始终保留
  if (isToolProseSection(name)) return ref.injectToolSections // 工具散文段按工具开关
  return ref.injectSystemPrompt // 其余官方段（人设/身份/系统）按系统提示词开关
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

  // 开关过滤瀑布：两个开关都开启时返回官方原有装配（不改动，保持官方缓存/稳定性优化）；
  // 任一关闭时按 shouldKeepSection 保留角色段 + Code 协议段 + 按开关的工具段/官方段。
  // 工具调用能力仅由 tools[] Schema 决定，本瀑布从不改动 assembly.tools。
  const disposeAssembly = childCtx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
    const assembly = (await next()) as PromptAssemblyLike | null
    const roleText = String(ref.systemPrompt ?? '')
    if (ref.injectSystemPrompt && ref.injectToolSections) {
      // 默认路径：官方已优化，不做改动（仅当 section API 不可用时兜底前置角色段）
      if (!sectionRegistered && roleText.trim()) {
        const sections = Array.isArray(assembly?.sections) ? [...assembly.sections] : []
        return { ...assembly, sections: [{ name: VISUAL_WORKFLOW_PROMPT_SECTION, text: roleText }, ...sections] }
      }
      return assembly
    }
    // 任一开关关闭：section API 不可用时兜底先行注入角色段，再按 shouldKeepSection 过滤。
    let baseSections = Array.isArray(assembly?.sections) ? [...assembly.sections] : []
    if (!sectionRegistered && roleText.trim()) {
      baseSections = [{ name: VISUAL_WORKFLOW_PROMPT_SECTION, text: roleText }, ...baseSections]
    }
    const sections = baseSections.filter((section) => shouldKeepSection(String(section.name), ref))
    // 上下文（运行时快照）属官方系统信息，随 injectSystemPrompt 开关；与工具段无关
    return { ...assembly, sections, contexts: ref.injectSystemPrompt ? (assembly?.contexts ?? []) : [] }
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
 * @returns contribution + attach + withPending + bindParent 四段式接口。
 */
export function createChildPromptSetup(): ChildPromptSetup {
  const states = new WeakMap<object, PromptStateRef>()
  const pending = new AsyncLocalStorage<ChildPromptState>()

  // 父代理（根 Agent）按 sessionId 的绑定表：每会话只注册一次，更新走可变状态。
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

  return { contribution, withPending, attach, bindParent }
}
