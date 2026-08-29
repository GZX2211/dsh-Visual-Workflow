// src/host/remote/api-catalog.ts
//
// GUI API 组合管理与插件目录端点（VisualWorkflowApiCatalog extends Ecosystem）：
// 工具组合 CRUD、MCP 服务器配置（托管区读写）与插件目录聚合
// （工具 ∪ MCP ∪ 已装载插件；含内置工具中文描述映射）。方法体逐字移动。

import { RESERVED_TRANSPORT_TOOL } from '../shared/protocol.js'
import { listMcpServers, upsertMcpServer, removeMcpServer, toggleMcpServer } from './mcp-registry.js'
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
      mcp: mcpServers.map((server: { id?: unknown; serverName?: unknown; url?: unknown; command?: unknown; transport?: unknown; disabled?: unknown; args?: unknown; env?: unknown }) => ({
        id: server.id,
        name: server.serverName,
        serverName: server.serverName,
        description: server.url
          ? `MCP 服务器（streamable-http：${server.url}）`
          : `MCP 服务器（stdio：${server.command}）`,
        transport: server.transport,
        disabled: server.disabled === true,
        // 组合管理「编辑」表单的字段来源：缺失时编辑后启动命令/参数恒为空
        command: String(server.command ?? ''),
        args: Array.isArray(server.args) ? server.args : [],
        env: server.env ?? {},
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
      env: server.env ?? {},
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
}

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
}

function zhDescription(name: string, fallback: string): string {
  const hit = TOOL_ZH[name]
  if (hit) return hit
  const text = String(fallback ?? '').trim()
  if (!text) return '（暂无描述）'
  return /[\u4e00-\u9fa5]/.test(text) ? text : `[EN] ${text}`
}