/** MCP 工具名前缀常量（官方 publicToolName 拼装规则）。 */
export declare const MCP_TOOL_PREFIX = "mcp__";
/** Tag 种类（all=全部；builtin=官方工具；mcp=动态 MCP 服务器）。 */
export type ToolTagKind = 'all' | 'builtin' | 'mcp';
/** 筛选标签条目。 */
export interface ToolTag {
    /** 稳定键：'all' | 'builtin' | `mcp:<server>`。 */
    key: string;
    /** 展示标签。 */
    label: string;
    kind: ToolTagKind;
    /** MCP 服务器命名空间（kind='mcp' 时有值）。 */
    server?: string;
}
/** 「全部」Tag 键。 */
export declare const TAG_ALL = "all";
/** 「官方工具」Tag 键。 */
export declare const TAG_BUILTIN = "builtin";
/**
 * 从工具名解析 MCP 服务器命名空间（mcp__<server>__<tool> → <server>）。
 * 非 MCP 名 / 形如 mcp__xxx（无第二段）返回 null。
 */
export declare function mcpServerOfToolName(name: string): string | null;
/**
 * 判断工具名是否属于某服务器（前缀匹配；server 为配置名或解析命名空间均可）。
 */
export declare function toolBelongsToServer(name: string, server: string): boolean;
/**
 * 服务器名规范化（镜像官方 mcp-client 的 INVALID_NAME_CHARS 替换规则：
 * 非 [A-Za-z0-9_-] 字符替换为下划线）。用于把工具名解析出的命名空间
 * 反查回已配置 serverName（标签显示配置原名）。
 */
export declare function normalizeServerName(serverName: string): string;
/**
 * 构建 Tag 列表：[全部] + [官方工具] + 动态 MCP Tag（首次出现顺序）。
 * @param toolNames 工具目录全量名（pluginCatalog.items[].name）
 * @param configuredServers 已配置 MCP 服务器（serverName 优先作为标签显示）
 */
export declare function buildToolTags(toolNames: string[], configuredServers?: Array<{
    serverName?: string;
}>): ToolTag[];
/**
 * 按当前激活 Tag 过滤工具名（纯函数）：
 *   - all：全部保留；
 *   - builtin：仅非 MCP 工具；
 *   - mcp:<server>：仅隶属于该命名空间的工具（前缀匹配）。
 */
export declare function filterToolNamesByTag(toolNames: string[], activeTag: string): string[];
