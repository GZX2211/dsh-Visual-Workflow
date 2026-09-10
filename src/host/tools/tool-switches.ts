// src/host/tools/tool-switches.ts
//
// 全局工具开关（父代理工具白名单的「关闭」侧）：独立于工作流编排逻辑的新模块。
//
// 背景（官方源码取证结论）：
//   - 父代理（会话根 Agent）没有子代理的 toolFilter 机制——toolFilter 是
//     ctx.subagents.startContinuable 的 request 字段，子代理专用；
//   - 官方 tools.restrict 需要 agent-scoped ctx（core/tools 显式拒绝全局 restriction：
//     "requires a scoped context"），且只对已存在的 agent 生效、只过滤继承面
//     （restrictions intersect；own layer registered tools 恒可见）——无法满足
//     「全局、任何会话、不点运行也生效」的诉求；
//   - 官方 system-prompt/assemble 瀑布的 assembly.tools 是模型可见工具 Schema 的
//     权威来源（dsh-tools wireSchemas → view(scope).visible → assembly.tools）。
//     dsh-scope 的 scopeTarget 过滤语义：注册在 **无 scope 标签 ctx** 上的 listener
//     对所有 scope 的 dispatch 都生效（unscoped = global admit），官方 own
//     invariant validator 即按此模式注册。因此在插件 ctx（unscoped）注册全局瀑布，
//     每次组装时剔除被关闭工具的 Schema（assembly.tools）与其使用指引散文段
//     （tool:<name> sections），即实现「关闭后所有会话、所有代理的上下文中都不可见」。
//
// 关闭工具的效果边界：
//   - 模型侧不可见（assembly.tools 剔除）：父代理与子代理均无法调用；
//   - 子代理白名单解析（resolveAgentTools）额外剔除（双保险）：杜绝 allow 名单携带；
//   - run_code（官方保留传输名）不在本模块管理范围（组合管理列表已剔除，官方
//     restrict/assembly 层永不改动它）；
//   - tools:sdk / tools:ptc-only（0.1.5-rc.1 更名前为 tools:code-only）协议段恒保留
//     （与 prompt-setup 同一约定：移除会让模型拿到工具清单却看不到调用协议 → UNKNOWN_TOOL）。
//
// 持久化：tool-switches.json（dataDir 根，与 combos.json / scheduler-tasks.json
// 平级），原子写协议（withJsonLock + atomicWriteJson），损坏 JSON 按空列表容忍。
// 内存缓存：load() 后 current 集即权威快照，瀑布过滤同步读取（无 await）。

import { join } from 'node:path'
import { atomicWriteJson, CorruptJsonError, readJson, withJsonLock } from '../storage/atomic.js'

/** 全局工具开关文档形态（tool-switches.json）。 */
export interface ToolSwitchDoc {
  /** 被关闭（父代理不可见）的工具名清单。 */
  disabled: string[]
}

/** 空文档（所有工具启用；disabled 为空数组）。 */
export function emptyToolSwitchDoc(): ToolSwitchDoc {
  return { disabled: [] }
}

/** 工具开关存储：持久化 + 内存快照（瀑布过滤同步读取）。 */
export class ToolSwitchStore {
  /** 内存权威快照（load/set 后即时生效；未 load 前为空集 = 不过滤）。 */
  private current = new Set<string>()

  constructor(private readonly root: string) {}

  /** 文件路径（tool-switches.json，与 combos.json 平级）。 */
  private path(): string {
    return join(this.root, 'tool-switches.json')
  }

  /** 读取磁盘文档（损坏 JSON 按空文档容忍；保存会重写完整文件）。 */
  private async readDoc(): Promise<ToolSwitchDoc> {
    try {
      const doc = await readJson<ToolSwitchDoc | null>(this.path(), null)
      return {
        disabled: Array.isArray(doc?.disabled) ? doc.disabled.map((name) => String(name)).filter(Boolean) : [],
      }
    } catch (error) {
      if (error instanceof CorruptJsonError) return emptyToolSwitchDoc()
      throw error
    }
  }

  /** 装载内存快照（Service.init 时调用；幂等）。 */
  async load(): Promise<void> {
    this.current = new Set(await this.readDisabled())
  }

  /** 当前被关闭的工具名集合（瀑布过滤与白名单解析共用；同步读取）。 */
  currentDisabled(): ReadonlySet<string> {
    return this.current
  }

  /** 读取关闭清单（磁盘权威；端点/测试用）。 */
  async readDisabled(): Promise<string[]> {
    const doc = await this.readDoc()
    return [...doc.disabled]
  }

  /**
   * 设置某个工具的开关状态（幂等）：
   *   - name 必须非空且非官方保留传输名 run_code（该名永远不可关闭）；
   *   - disabled=true 加入关闭清单；false 移出；
   *   - 原子落盘后刷新内存快照（全局过滤即时生效）。
   * @returns 更新后的完整关闭清单。
   */
  async setDisabled(name: string, disabled: boolean): Promise<string[]> {
    const toolName = String(name ?? '').trim()
    if (!toolName) throw new Error('工具名不能为空')
    const path = this.path()
    const doc = await withJsonLock(path, async () => {
      const current = await this.readDoc()
      const set = new Set(current.disabled)
      if (disabled) set.add(toolName)
      else set.delete(toolName)
      const next = [...set]
      await atomicWriteJson(path, { disabled: next })
      return next
    })
    this.current = new Set(doc)
    return [...doc]
  }

  /**
   * 批量设置一组工具的开关状态（幂等；组合管理「标签一键开关」用）：
   *   - 空名/空白名直接忽略（不报错——批量场景逐个校验收敛为「有效集合」）；
   *   - disabled=true 全部加入关闭清单；false 全部移出；
   *   - 单次原子落盘（与单工具 setDisabled 同一把锁），成功后一次性刷新内存快照。
   * @returns 更新后的完整关闭清单。
   */
  async setDisabledMany(names: string[], disabled: boolean): Promise<string[]> {
    const toolNames = (Array.isArray(names) ? names : [])
      .map((name) => String(name ?? '').trim())
      .filter(Boolean)
    const path = this.path()
    const doc = await withJsonLock(path, async () => {
      const current = await this.readDoc()
      const set = new Set(current.disabled)
      for (const toolName of toolNames) {
        if (disabled) set.add(toolName)
        else set.delete(toolName)
      }
      const next = [...set]
      await atomicWriteJson(path, { disabled: next })
      return next
    })
    this.current = new Set(doc)
    return [...doc]
  }
}

// ---------------------------------------------------------------------------
// 装配过滤（纯函数 + 注册器）
// ---------------------------------------------------------------------------

/**
 * Code Mode 协议段：恒保留（与 prompt-setup 同一约定）。
 * 0.1.5-rc.1 官方把 tools:code-only 更名为 tools:ptc-only（dsh-tools collapseSection），
 * 三名并列以同时容忍新旧宿主。
 */
const CODE_PROTOCOL_SECTIONS = ['tools:sdk', 'tools:ptc-only', 'tools:code-only'] as const

function isCodeProtocolSection(name: string): boolean {
  return CODE_PROTOCOL_SECTIONS.includes(name as (typeof CODE_PROTOCOL_SECTIONS)[number])
}

/** system-prompt/assemble 瀑布的 assembly 最小形状（零官方类型依赖）。 */
export interface PromptAssemblyLike {
  sections?: Array<{ name: string; text: string }>
  contexts?: unknown[]
  tools?: Array<{ name: string; description?: string; parameters?: unknown }>
  variables?: Record<string, unknown>
}

/** 瀑布上下文最小形状（on 方法；unscoped ctx 注册全局生效）。 */
export interface FilterContextLike {
  on(name: string, listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void
}

/**
 * 纯函数：从组装结果中剔除被关闭工具（assembly.tools Schema 与 tool:<name> 散文段）。
 * 幂等且确定性：同一输入同一输出；disabled 为空时原样返回（不改动官方组装）。
 */
export function filterToolsInAssembly(assembly: PromptAssemblyLike, disabled: ReadonlySet<string>): PromptAssemblyLike {
  if (disabled.size === 0) return assembly
  const tools = Array.isArray(assembly.tools)
    ? assembly.tools.filter((tool) => !disabled.has(String(tool?.name ?? '')))
    : assembly.tools
  const sections = Array.isArray(assembly.sections)
    ? assembly.sections.filter((section) => {
        const name = String(section?.name ?? '')
        if (isCodeProtocolSection(name)) return true // Code Mode 协议段恒保留
        if (name.startsWith('tool:')) return !disabled.has(name.slice('tool:'.length)) // 工具散文段按开关
        return true
      })
    : assembly.sections
  return { ...assembly, tools, sections }
}

/**
 * 注册全局工具开关瀑布（host 层；unscoped ctx 对所有 agent 组装生效）：
 *   - 每次组装时先执行官方/上游瀑布（next()），再剔除被关闭工具；
 *   - 过滤读取内存快照（同步），开关切换即时生效；
 *   - 返回 disposer（插件卸载时撤销）。
 */
export function registerToolSwitchFilter(ctx: FilterContextLike, store: ToolSwitchStore): () => void {
  return ctx.on('system-prompt/assemble', async (rawAssembly, _context, next) => {
    const assembly = (await next()) as PromptAssemblyLike | null
    if (!assembly) return assembly
    return filterToolsInAssembly(assembly, store.currentDisabled())
  }) as () => void
}
