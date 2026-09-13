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
// 默认策略（用户裁决 2026.09）：**所有工具默认开启**，不存在「默认关闭种子」。
// 早期版本把自主编排的两个工具（wf_org_catalog / wf_graph_patch）做成默认关闭种子，
// 后果是「磁盘权威清单（用户项）与内存生效快照（用户项 ∪ 种子）」两套状态并存：
// 组合管理读磁盘清单，于是把被种子隐藏的工具显示成「已开启」，用户点按钮反而把它
// 真正关掉——表现为「开关间歇性失灵 / 界面说开着但 AI 收不到工具」。用户裁决删除
// 种子，改为默认开启（默认关闭属方案错误）；两个工具仍由本开关统一控制，
// 子代理侧另有 CHILD_AGENT_HIDDEN_TOOLS 永久隐藏（父代理专属，见 runner.ts）。
//
// 关闭工具的效果边界：
//   - 模型侧不可见（assembly.tools 剔除）：父代理与子代理均无法调用；
//   - 子代理白名单解析（resolveAgentTools）额外剔除（双保险）：杜绝 allow 名单携带；
//   - run_code（官方保留传输名）不在本模块管理范围（组合管理列表已剔除，官方
//     restrict/assembly 层永不改动它）；
//   - tools:sdk / tools:ptc-only（0.1.5-rc.1 更名前为 tools:code-only）协议段恒保留
//     （与 prompt-setup 同一约定：移除会让模型拿到工具清单却看不到调用协议 → UNKNOWN_TOOL）。
//
// 跨进程一致性（为什么要有 ensureFresh）：
//   - 模式二服务进程是 fork 出来的**独立 DSH 实例**（同一 dataDir），其它 dsh 进程
//     也可能并发读写同一份 tool-switches.json；只在 Service.init 读一次会让已启动的
//     服务进程永远看不到用户在 GUI 里翻的开关——同一开关在不同 Agent 上表现不一致；
//   - 因此内存快照改为「按需刷新」：ensureFresh() 以 mtimeMs + size 指纹比对判断磁盘
//     是否被别的进程改过，未变则零解析直接返回（一次 stat 的代价）。
//     调用点：system-prompt/assemble 瀑布（每次组装前）与子代理白名单解析
//     （resolveAgentTools，经 host 注入的异步缝）各一次。
//
// 持久化：tool-switches.json（dataDir 根，与 combos.json / scheduler-tasks.json
// 平级），原子写协议（withJsonLock + atomicWriteJson），损坏 JSON 按空列表容忍。
// 内存缓存：load() 后 current 集即权威快照，瀑布过滤同步读取（无 await）。

import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { atomicWriteJson, CorruptJsonError, readJson, withJsonLock } from '../storage/atomic.js'

/** 全局工具开关文档形态（tool-switches.json）。 */
export interface ToolSwitchDoc {
  /** 被关闭（父代理不可见）的工具名清单。 */
  disabled: string[]
}

/** 磁盘指纹（ensureFresh 的比对基准：mtimeMs + size）。 */
export interface FileStamp {
  mtimeMs: number
  size: number
}

/** 空文档（默认全部工具开启）。 */
export function emptyToolSwitchDoc(): ToolSwitchDoc {
  return { disabled: [] }
}

/** 工具开关存储：持久化 + 内存快照（瀑布过滤同步读取）+ 跨进程按需刷新。 */
export class ToolSwitchStore {
  /** 内存权威快照（load/set/ensureFresh 后即时生效；未 load 前为空集 = 不过滤）。 */
  private current = new Set<string>
  /** 上次读盘时的文件指纹（null = 文件不存在或尚未读盘）。 */
  private stamp: FileStamp | null = null

  constructor(private readonly root: string) {}

  /** 文件路径（tool-switches.json，与 combos.json 平级）。 */
  private path(): string {
    return join(this.root, 'tool-switches.json')
  }

  /**
   * 读取磁盘文档（损坏 JSON 按空文档容忍；保存会重写完整文件）。
   * 兼容历史字段：早期版本写过 `enabled` 记账键，现语义已废弃——读取时忽略，
   * 下一次原子写会把它自然清掉（无需迁移脚本）。
   */
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

  /** 当前文件指纹（不存在返回 null；其它 IO 错误按「无变化」处理，不抛给调用方）。 */
  private async stampOf(): Promise<FileStamp | null> {
    try {
      const info = await stat(this.path())
      return { mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return null
    }
  }

  /** 装载内存快照（Service.init 时调用；幂等）：默认全部开启，只含用户关闭项。 */
  async load(): Promise<void> {
    this.current = new Set(await this.readDisabled())
    this.stamp = await this.stampOf()
  }

  /** 当前被关闭的工具名集合（瀑布过滤与白名单解析共用；同步读取）。 */
  currentDisabled(): ReadonlySet<string> {
    return this.current
  }

  /** 读取关闭清单（磁盘权威；持久化往返断言用）。 */
  async readDisabled(): Promise<string[]> {
    const doc = await this.readDoc()
    return [...doc.disabled]
  }

  /** 生效态清单（异步；先跨进程刷新再取快照——GUI 端点与工具报告统一走这里）。 */
  async effectiveDisabled(): Promise<string[]> {
    await this.ensureFresh()
    return [...this.current]
  }

  /**
   * 跨进程刷新（幂等、并发安全）：磁盘指纹变了才重读，未变零解析。
   *   - 同进程内的 setDisabled/setDisabledMany 已直接更新快照与指纹，不会重复读盘；
   *   - 文件被删除（指纹 null）而快照非空时按「空清单」重载（与损坏 JSON 同语义）。
   */
  async ensureFresh(): Promise<void> {
    const next = await this.stampOf()
    const unchanged = this.stamp === null
      ? next === null
      : next !== null && next.mtimeMs === this.stamp.mtimeMs && next.size === this.stamp.size
    if (unchanged) return
    this.current = new Set(await this.readDisabled())
    this.stamp = next
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
    // 本进程写入即权威：快照与指纹同步更新（避免下一次 ensureFresh 白读一次）
    this.current = new Set(doc)
    this.stamp = await this.stampOf()
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
    const next = await withJsonLock(path, async () => {
      const current = await this.readDoc()
      const set = new Set(current.disabled)
      for (const toolName of toolNames) {
        if (disabled) set.add(toolName)
        else set.delete(toolName)
      }
      const merged = [...set]
      await atomicWriteJson(path, { disabled: merged })
      return merged
    })
    this.current = new Set(next)
    this.stamp = await this.stampOf()
    return [...next]
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
 *   - 每次组装先跨进程刷新开关快照（别的 dsh 进程改过磁盘即重读），再执行官方/
 *     上游瀑布（next()），最后剔除被关闭工具；
 *   - 过滤读取内存快照（同步），开关切换即时生效；
 *   - 返回 disposer（插件卸载时撤销）。
 */
export function registerToolSwitchFilter(ctx: FilterContextLike, store: ToolSwitchStore): () => void {
  return ctx.on('system-prompt/assemble', async (rawAssembly, _context, next) => {
    await store.ensureFresh()
    const assembly = (await next()) as PromptAssemblyLike | null
    if (!assembly) return assembly
    return filterToolsInAssembly(assembly, store.currentDisabled())
  }) as () => void
}
