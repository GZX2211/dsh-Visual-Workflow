// src/host/remote/api-catalog.ts
//
// GUI API 组合管理与插件目录端点（VisualWorkflowApiCatalog extends Ecosystem）：
// 工具组合 CRUD、MCP 服务器配置（托管区读写）与插件目录聚合
// （工具 ∪ MCP ∪ 已装载插件；含内置工具中文描述映射）。方法体逐字移动。

import { RESERVED_TRANSPORT_TOOL } from '../shared/protocol.js'
import { listMcpServers, upsertMcpServer, removeMcpServer, toggleMcpServer, renderCommandLine } from './mcp-registry.js'
import { httpError } from './http.js'
import { VisualWorkflowApiEcosystem } from './api-ecosystem.js'

export class VisualWorkflowApiCatalog extends VisualWorkflowApiEcosystem {
  // ---------- 工具组合 / 插件目录 / MCP ----------

  async toolCombos(): Promise<unknown> {
    return this.host.store.listToolCombos()
  }

  async toolComboPut(args: { combo?: unknown }): Promise<unknown> {
    const combo = args?.combo as Record<string, unknown> | null | undefined
    const id = String(combo?.id ?? '')
    if (!combo || !id.startsWith('combo-') || !String(combo.name ?? '').trim()) {
      throw httpError(400, '组合需要 combo- 前缀 id 与名称')
    }
    return this.host.store.saveToolCombo({
      id: id as `combo-${string}`,
      name: String(combo.name).trim(),
      tools: Array.isArray(combo.tools)
        ? combo.tools.filter((name) => typeof name === 'string' && name && name !== RESERVED_TRANSPORT_TOOL)
        : [],
      mcpServers: Array.isArray(combo.mcpServers) ? combo.mcpServers.filter((name) => typeof name === 'string' && name) : [],
    })
  }

  async toolComboDelete(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return { deleted: await this.host.store.deleteToolCombo(id) }
  }

  /**
   * 插件目录：工具（全局层 ∪ 存活 agent scope ∪ preset standing scope，含中文
   * 描述映射）+ MCP 服务器 + 已装载插件摘要。scope key 必须是 agent 对象本身
   * （官方 ScopeKey 语义），传错只能看到全局层。
   */
  async pluginCatalog(args: { sessionId?: unknown }): Promise<unknown> {
    const sessionId = String(args?.sessionId ?? '')
    const schemas = await this.allToolSchemas(sessionId || undefined)
    const mcpServers = await listMcpServers().catch(() => [])
    const items: unknown[] = []
    const seen = new Set<string>()
    for (const schema of schemas) {
      const entry = schema as { name?: unknown; title?: unknown; description?: unknown }
      const name = String(entry.name ?? entry.title ?? '')
      if (!name || seen.has(name)) continue
      seen.add(name)
      items.push({
        key: `tool:${name}`,
        name,
        description: zhDescription(name, String(entry.description ?? '')),
        kind: 'tool',
        source: name.startsWith('mcp__') ? 'mcp' : 'builtin',
      })
    }
    const loader = this.ctx.get('loader') as { entries?: () => unknown[] } | null | undefined
    let loadedPlugins: string[] = []
    try {
      if (loader && typeof loader.entries === 'function') {
        const plugins: string[] = []
        for (const entry of loader.entries() ?? []) {
          const options = (entry as { options?: Record<string, unknown> })?.options ?? {}
          if (options.group) continue
          const name = String(options.name ?? '')
          if (!name || plugins.includes(name)) continue
          plugins.push(name)
        }
        loadedPlugins = plugins
      }
    } catch {
      loadedPlugins = []
    }
    return {
      items,
      loadedPlugins,
      disabledTools: await this.host.toolSwitches?.effectiveDisabled().catch(() => []) ?? [],
      mcp: mcpServers.map((server: { id?: unknown; serverName?: unknown; url?: unknown; command?: unknown; transport?: unknown; disabled?: unknown; args?: unknown; env?: unknown; headers?: unknown }) => ({
        id: server.id,
        name: server.serverName,
        serverName: server.serverName,
        description: server.url
          ? `MCP 服务器（streamable-http：${server.url}）`
          : `MCP 服务器（stdio：${renderCommandLine(String(server.command ?? ''), (server.args ?? []) as string[])}）`,
        transport: server.transport,
        disabled: server.disabled === true,
        // 组合管理「编辑」表单的字段来源：缺失时编辑后启动命令/参数恒为空
        command: String(server.command ?? ''),
        args: Array.isArray(server.args) ? server.args : [],
        commandLine: renderCommandLine(String(server.command ?? ''), (Array.isArray(server.args) ? server.args : []) as string[]),
        env: server.env ?? {},
        headers: server.headers ?? {},
        url: String(server.url ?? ''),
        category: 'mcp',
      })),
    }
  }

  /** 全部可见工具 schema（全局层 ∪ 存活 root agent ∪ preset standing scope）。 */
  private async allToolSchemas(sessionId?: string): Promise<unknown[]> {
    const tools = this.ctx.get('tools') as { schemas?: (scope?: unknown) => unknown } | null | undefined
    if (!tools || typeof tools.schemas !== 'function') return []
    const out = new Map<string, unknown>()
    const collect = (scope?: unknown): void => {
      let list: unknown[] = []
      try {
        list = scope === undefined ? ((tools.schemas?.() ?? []) as unknown[]) : ((tools.schemas?.(scope) ?? []) as unknown[])
      } catch {
        list = []
      }
      for (const schema of Array.isArray(list) ? list : []) {
        const name = String((schema as { name?: unknown; title?: unknown })?.name ?? (schema as { title?: unknown })?.title ?? '')
        if (name && !out.has(name)) out.set(name, schema)
      }
    }
    collect(undefined)
    const agents = this.ctx.get('agents') as { roots?: () => unknown[]; get?: (id: string) => unknown } | null | undefined
    if (agents && typeof agents.get === 'function') {
      const candidates = new Set<unknown>()
      try {
        for (const root of agents.roots?.() ?? []) {
          if (root && String((root as { id?: unknown })?.id ?? '')) candidates.add(root)
        }
      } catch {
        // roots 不可用
      }
      if (sessionId) {
        try {
          const agent = agents.get(sessionId)
          if (agent) candidates.add(agent)
        } catch {
          // 会话 agent 不可用
        }
      }
      for (const agent of candidates) collect(agent)
    }
    const agentPresets = this.ctx.get('agentPresets') as { list?: () => Promise<unknown[]>; standingKeyFor?: (id: string) => Promise<unknown> } | null | undefined
    if (agentPresets && typeof agentPresets.list === 'function' && typeof agentPresets.standingKeyFor === 'function') {
      try {
        for (const item of (await agentPresets.list()) ?? []) {
          const pid = String((item as { id?: unknown })?.id ?? '').trim()
          if (!pid) continue
          try {
            const key = await agentPresets.standingKeyFor(pid)
            if (key !== undefined) collect(key)
          } catch {
            // 单个 preset 失败跳过
          }
        }
      } catch {
        // agentPresets 不可用
      }
    }
    // 剔除官方保留的 Code Mode 传输名 run_code：组合管理可选列表不得展示
    // （子代理自动携带该工具，且官方 restrict 禁止其进入 allow/deny 名单）。
    // 注意：不剔除其它工具——str_replace_editor 等官方简单模式专用工具保留展示，
    // 在描述中标注「简单模式专用，非该模式禁止勾选」，运行时由 resolveAgentTools
    // 兜底（父代理 scope 视图过滤），避免勾选后官方 restrict 抛 unknown。
    return [...out.values()].filter((schema) => {
      const entry = schema as { name?: unknown; title?: unknown }
      return String(entry.name ?? entry.title ?? '') !== RESERVED_TRANSPORT_TOOL
    })
  }

  /** MCP 服务器：列表 / 增删改 / 启停（写入 profile 托管区，重启生效）。 */
  async mcpList(): Promise<unknown> {
    const servers = await listMcpServers()
    return servers.map((server) => ({
      id: server.id,
      serverName: server.serverName,
      transport: server.transport,
      command: server.command ?? '',
      args: server.args ?? [],
      commandLine: renderCommandLine(server.command ?? '', server.args ?? []),
      env: server.env ?? {},
      headers: server.headers ?? {},
      url: server.url ?? '',
      disabled: server.disabled === true,
    }))
  }

  async mcpPut(args: { server?: unknown }): Promise<unknown> {
    return upsertMcpServer(args?.server ?? {})
  }

  async mcpDelete(args: { id?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return removeMcpServer(id)
  }

  async mcpToggle(args: { id?: unknown; disabled?: unknown }): Promise<unknown> {
    const id = String(args?.id ?? '')
    if (!id) throw httpError(400, 'requires id')
    return toggleMcpServer(id, args?.disabled !== false)
  }

  // ---------- 全局工具开关（父代理工具白名单「关闭」侧） ----------

  /**
   * 全局工具开关列表（被关闭 = 父代理上下文不可见；独立于工作流运行状态）。
   * 生效态口径与 system-prompt/assemble 瀑布完全一致（effectiveDisabled 先做跨进程
   * 刷新再取内存快照）——历史上这里读「磁盘用户项」曾与生效态分叉，导致组合管理
   * 把被默认种子隐藏的工具显示成「已开启」（界面说谎 → 用户以为开关失灵）。
   */
  async toolSwitches(): Promise<unknown> {
    if (!this.host.toolSwitches) throw httpError(501, 'tool switches unavailable')
    return { disabled: await this.host.toolSwitches.effectiveDisabled() }
  }

  /** 设置单个工具开/关状态（全局即时生效；返回更新后的完整关闭清单）。 */
  async toolSwitchPut(args: { name?: unknown; disabled?: unknown }): Promise<unknown> {
    if (!this.host.toolSwitches) throw httpError(501, 'tool switches unavailable')
    const name = String(args?.name ?? '')
    if (!name) throw httpError(400, '工具开关需要 name')
    if (name === RESERVED_TRANSPORT_TOOL) {
      throw httpError(400, `${RESERVED_TRANSPORT_TOOL} 为官方保留传输名，不可关闭`)
    }
    return { disabled: await this.host.toolSwitches.setDisabled(name, args?.disabled !== false) }
  }

  /**
   * 批量设置一组工具开/关状态（组合管理「标签一键开关」：把某标签下全部工具统一关/开）。
   *   - names 必须非空数组；空白名忽略；官方保留传输名 run_code 静默跳过（不可关闭）；
   *   - 单次原子落盘 + 刷新内存快照，全局即时生效。
   * @returns 更新后的完整关闭清单。
   */
  async toolSwitchPutMany(args: { names?: unknown; disabled?: unknown }): Promise<unknown> {
    if (!this.host.toolSwitches) throw httpError(501, 'tool switches unavailable')
    const names = (Array.isArray(args?.names) ? args.names : [])
      .map((name) => String(name ?? '').trim())
      .filter((name) => name && name !== RESERVED_TRANSPORT_TOOL)
    if (names.length === 0) throw httpError(400, '工具批量开关需要一个以上可设置的工具名')
    return { disabled: await this.host.toolSwitches.setDisabledMany(names, args?.disabled !== false) }
  }
}

/**
 * 组合管理卡片描述上限（字符）。
 * 模型侧工具 description 面向模型可以长（错误码/op 组约束等），但卡片只有几十像素宽：
 * 不截断就会把文本挤出卡片边框（2026.09 用户报障）。此处做数据层兜底，客户端另有
 * CSS 行数钳制（styles.ts `.wf-combo-card__desc`）与卡片最小高度（`.wf-combo-card`）。
 * 取 80：约合卡片内 2 行文本（10px 字号 / 约 200px 内容宽），与卡片最小高度 96px 匹配，
 * 保证「名称 + 描述 + 操作按钮」三者在卡片内互不重叠。
 */
export const CARD_DESC_MAX = 80

/** 内置常用工具中文描述映射（未命中回退原文，英文加 [EN] 前缀）。 */
const TOOL_ZH: Record<string, string> = {
  read: '读取文件内容（支持多种编码与行区间）',
  write: '创建或整体替换文件内容',
  edit: '对已有文件做精确的局部文本替换',
  bash: '在沙箱中执行 shell 命令',
  run_code: '在代码运行时中执行一段代码',
  str_replace_editor: '代码/文本编辑器：查看、替换、插入、撤销（简单模式专用，非该模式禁止勾选）',
  glob: '按通配符模式查找文件路径',
  grep: '在文件内容中按正则搜索并返回匹配行',
  todo_write: '维护并更新结构化任务清单',
  pwsh: '执行 PowerShell 命令',
  ask_user_question: '向用户提问并等待答复',
  web_search: '联网搜索当前信息',
  ssh_exec: '在配置的 SSH 主机上执行远程命令',
  ssh_list: '列出已配置的 SSH 主机',
  ssh_upload: '上传本地文件到 SSH 主机',
  ssh_download: '从 SSH 主机下载文件到本地',
  ssh_tunnel: '管理本地端口转发隧道',
  ssh_cluster: '在多台 SSH 主机上并发执行同一命令',
  list_agents: '列出可继续交互的后台子代理',
  send_message: '向后台子代理发送消息继续对话',
  interrupt_agent: '请求取消后台子代理当前回合',
  subagent: '委派自包含任务给子代理处理',
  workflow: '运行多子代理编排工作流脚本',
  // —— dsh-visual-workflow 自有工具：卡片用短中文，模型侧 schema 描述（英文）不受影响 ——
  wf_run_node: '启动节点子代理（异步非阻塞；父代理编排用）',
  wf_run_node_wait: '启动节点子代理并等待其完成（模式二服务用）',
  wf_finish: '结束工作流运行并释放运行锁',
  wf_ask: '子代理向主会话用户提问（官网提问卡）',
  wf_ask_agent: '代理间阻塞通信（ask / reply / resolve）',
  wf_db_query: '数据库三模式访问（search / query / schema；需 db-in 连线）',
  wf_org_catalog: '只读勘察组织资产（角色/组合/工具/preset/数据源/模板/预算）；仅父代理可用',
  wf_graph_patch: '改写工作流图（图结构 / 元参数 / 里程碑标记，一次补丁仅一组）；仅父代理可用',
}

/**
 * 组合管理卡片描述（纯函数，导出供单测）：
 *   - 命中 TOOL_ZH → 短中文；
 *   - 未命中 → schema 原文（英文加 [EN] 前缀；已是中文则原样）；
 *   - **一律按 CARD_DESC_MAX 截断**（超长描述不得撑破卡片）。
 */
export function zhDescription(name: string, fallback: string): string {
  const hit = TOOL_ZH[String(name ?? '')]
  let text: string
  if (hit) {
    text = hit
  } else {
    const raw = String(fallback ?? '').trim()
    text = !raw ? '（暂无描述）' : (/[\u4e00-\u9fa5]/.test(raw) ? raw : `[EN] ${raw}`)
  }
  return text.length > CARD_DESC_MAX ? `${text.slice(0, CARD_DESC_MAX - 1)}…` : text
}