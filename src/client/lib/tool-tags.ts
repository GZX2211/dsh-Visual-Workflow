// src/client/lib/tool-tags.ts
//
// 组合管理「工具」Tab 的筛选标签纯逻辑（需求：官方工具 + 动态 MCP 服务器 Tag）：
//   - 官方工具 = 非 mcp__ 前缀工具；
//   - MCP 工具名恒为 mcp__<server>__<tool>（官方 dsh-mcp-client publicToolName；
//     服务名/工具名含非法字符时整体规范化并追加哈希后缀，<server> 段即规范化后的
//     命名空间）；
//   - Tag 列表 = [全部] + [官方工具] + 动态 MCP Tag（按工具目录首次出现顺序）；
//   - 标签显示优先匹配已配置 serverName（mcp__<serverName>__ 前缀命中即用配置名），
//     未命中用工具名解析出的命名空间片段（规范化兜底）。
// 纯函数：无状态、不读时钟/随机源，便于单测。

/** MCP 工具名前缀常量（官方 publicToolName 拼装规则）。 */
export const MCP_TOOL_PREFIX = 'mcp__'

/** Tag 种类（all=全部；builtin=官方工具；mcp=动态 MCP 服务器）。 */
export type ToolTagKind = 'all' | 'builtin' | 'mcp'

/** 筛选标签条目。 */
export interface ToolTag {
  /** 稳定键：'all' | 'builtin' | `mcp:<server>`。 */
  key: string
  /** 展示标签。 */
  label: string
  kind: ToolTagKind
  /** MCP 服务器命名空间（kind='mcp' 时有值）。 */
  server?: string
}

/** 「全部」Tag 键。 */
export const TAG_ALL = 'all'
/** 「官方工具」Tag 键。 */
export const TAG_BUILTIN = 'builtin'

/**
 * 从工具名解析 MCP 服务器命名空间（mcp__<server>__<tool> → <server>）。
 * 非 MCP 名 / 形如 mcp__xxx（无第二段）返回 null。
 */
export function mcpServerOfToolName(name: string): string | null {
  const text = String(name ?? '')
  if (!text.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = text.slice(MCP_TOOL_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  return rest.slice(0, sep)
}

/**
 * 判断工具名是否属于某服务器（前缀匹配；server 为配置名或解析命名空间均可）。
 */
export function toolBelongsToServer(name: string, server: string): boolean {
  return String(name ?? '').startsWith(`${MCP_TOOL_PREFIX}${server}__`)
}

/**
 * 服务器名规范化（镜像官方 mcp-client 的 INVALID_NAME_CHARS 替换规则：
 * 非 [A-Za-z0-9_-] 字符替换为下划线）。用于把工具名解析出的命名空间
 * 反查回已配置 serverName（标签显示配置原名）。
 */
export function normalizeServerName(serverName: string): string {
  return String(serverName ?? '').replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * 构建 Tag 列表：[全部] + [官方工具] + 动态 MCP Tag（首次出现顺序）。
 * @param toolNames 工具目录全量名（pluginCatalog.items[].name）
 * @param configuredServers 已配置 MCP 服务器（serverName 优先作为标签显示）
 */
export function buildToolTags(
  toolNames: string[],
  configuredServers: Array<{ serverName?: string }> = [],
): ToolTag[] {
  const namespaces: string[] = []
  for (const name of toolNames ?? []) {
    const server = mcpServerOfToolName(name)
    if (server === null) continue
    if (!namespaces.includes(server)) namespaces.push(server)
  }
  const configured = configuredServers
    .map((item) => String(item?.serverName ?? '').trim())
    .filter(Boolean)
  const tags: ToolTag[] = [
    { key: TAG_ALL, label: '全部', kind: 'all' },
    { key: TAG_BUILTIN, label: '官方工具', kind: 'builtin' },
  ]
  for (const namespace of namespaces) {
    // 标签显示优先用已配置 serverName：命名空间 == 配置名的规范化形式（服务名含
    // 非法字符被替换）时反查回配置原名；未命中用解析的命名空间片段。
    const label = configured.find((serverName) => normalizeServerName(serverName) === namespace) ?? namespace
    tags.push({ key: `mcp:${namespace}`, label, kind: 'mcp', server: namespace })
  }
  return tags
}

/**
 * 按当前激活 Tag 过滤工具名（纯函数）：
 *   - all：全部保留；
 *   - builtin：仅非 MCP 工具；
 *   - mcp:<server>：仅隶属于该命名空间的工具（前缀匹配）。
 */
export function filterToolNamesByTag(toolNames: string[], activeTag: string): string[] {
  return (toolNames ?? []).filter((name) => {
    if (activeTag === TAG_ALL) return true
    if (activeTag === TAG_BUILTIN) return mcpServerOfToolName(name) === null
    if (activeTag.startsWith('mcp:')) {
      const server = activeTag.slice('mcp:'.length)
      return toolBelongsToServer(name, server)
    }
    return true
  })
}
