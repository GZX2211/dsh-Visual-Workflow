// src/host/agent/prompt-setup.ts
//
// 子代理系统提示词注入（T-021 配套）：
//   - 标准模式：把节点自定义 System Prompt 作为「完整系统提示词」注入，
//     替换官方 Harness/部署 persona 等系统提示段（需求 §4.2.3.2 规则 1）；
//   - Code Mode（presetId = 'code'）：不覆盖官方工具调用提示词，仅通过
//     startContinuable 的 persona 字段遮蔽部署 persona（官方 persona 语义），
//     本注入只负责把协作 Prompt 追加到系统提示词末尾（架构 §13.1.4）；
//   - 协作 Prompt：以 `collab:` 前缀追加到系统提示词末尾，不对既有前缀重排。
//
// 为什么用 system-prompt/assemble 瀑布而不是在 request.persona 里拼串：
//   - request.persona 只能注册 deployment:persona 段，无法表达「完整替换」；
//   - registerContinuableSetup 贡献拿不到节点参数（签名只有 childCtx），
//     因此沿用 model-selection 的 WeakMap 方案：贡献先挂监听，runner 在
//     startContinuable 返回后再 attach 节点级状态；监听在真正组装提示词时
//     读状态，避免创建期并发竞态。

import { buildCollabPrompt } from '../prompts/collab.js'

/** 子代理提示词注入状态（runner 在节点启动后写入）。 */
export interface ChildPromptState {
  /** 节点自定义 System Prompt（可为空；标准模式下为空表示系统提示词为空）。 */
  systemPrompt: string
  /** 协作组 Prompt（组卡片 data.collabPrompt；非组内成员为空）。 */
  collabPrompt: string
  /** true=标准模式完整替换；false=Code Mode，仅追加 collab 且保留官方工具调用提示词。 */
  complete: boolean
}

/** 子代理提示词注入装配（与 model-selection 相同的贡献/attach 两段式）。 */
export interface ChildPromptSetup {
  /** 经 registerContinuableSetup 注册的贡献（每个子代理创建时安装监听）。 */
  contribution: (childCtx: unknown) => () => void
  /** 子代理创建完成后由 runner 调用：写入节点级提示词状态。 */
  attach(childCtx: unknown, state: ChildPromptState): void
}

/** system-prompt/assemble 事件的最小组装形状（零官方类型依赖）。 */
interface PromptAssemblyLike {
  sections?: Array<{ name: string; text: string }>
  contexts?: unknown[]
  tools?: unknown[]
  variables?: Record<string, unknown>
}

/** 子代理上下文最小结构（on/apply 用于挂 waterfall 监听）。 */
interface PromptChildContextLike {
  on(name: string, listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void
}

/**
 * 创建子代理提示词注入装配。
 *
 * @returns contribution + attach 两段式：contribution 在子代理创建窗口安装
 * `system-prompt/assemble` 监听；attach 在子代理启动后写入节点级状态。
 */
export function createChildPromptSetup(): ChildPromptSetup {
  const states = new WeakMap<object, ChildPromptState>()

  const contribution = (rawChildCtx: unknown): (() => void) => {
    const childCtx = rawChildCtx as PromptChildContextLike
    if (typeof childCtx?.on !== 'function') return () => {}

    const dispose = childCtx.on('system-prompt/assemble', async (rawAssembly, _rawContext, next) => {
      const assembly = (await next()) as PromptAssemblyLike | null
      const state = states.get(childCtx as object)
      if (!state) return assembly
      const sections = Array.isArray(assembly?.sections) ? [...assembly.sections] : []

      if (state.complete) {
        // 标准模式：完整替换系统提示词。空字符串也作为 complete 段保留，
        // renderPrompt 会过滤空段，从而实现「System Prompt 为空时提示词即为空」。
        const customSections: Array<{ name: string; text: string }> = [
          { name: 'visual-workflow:persona', text: String(state.systemPrompt ?? '').trim() },
        ]
        if (String(state.collabPrompt ?? '').trim()) {
          customSections.push({ name: 'visual-workflow:collab', text: buildCollabPrompt(state.collabPrompt) })
        }
        return { ...assembly, sections: customSections }
      }

      // Code Mode：仅追加协作 Prompt，保留官方工具调用提示词与 persona 段。
      if (String(state.collabPrompt ?? '').trim()) {
        sections.push({ name: 'visual-workflow:collab', text: buildCollabPrompt(state.collabPrompt) })
      }
      return { ...assembly, sections }
    }) as () => void

    return dispose
  }

  const attach = (childCtx: unknown, state: ChildPromptState): void => {
    if (!childCtx || typeof childCtx !== 'object') return
    states.set(childCtx as object, {
      systemPrompt: String(state.systemPrompt ?? ''),
      collabPrompt: String(state.collabPrompt ?? ''),
      complete: state.complete === true,
    })
  }

  return { contribution, attach }
}
