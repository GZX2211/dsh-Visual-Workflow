export interface McpServerRow {
    id: string;
    serverName: string;
    transport: 'stdio' | 'streamable-http';
    command: string;
    args: string[];
    env: Record<string, string>;
    headers: Record<string, string>;
    url: string;
    disabled: boolean;
}
/** 定位 profile 的 cordis.patch.yml（优先 "web"，回退第一个含该文件的 profile 目录）。 */
export declare function hostPatchPath(): string;
/**
 * serverName 规范化：对齐官方校验口径。
 *
 * 【0.1.7-rc.1 取证】官方 dsh-mcp-client 的 serverName 正则为
 * `/^[A-Za-z0-9_-]{1,32}$/`（lib/index.js L767，schema 见 L782/L793）：仅允许
 * 字母/数字/下划线/连字符，长度 1–32。旧实现替换规则放行 `.` 且不设长度上限，
 * 含点或超长的名字写入 profile 行后会在挂载时 schemastery 校验失败。
 * 此处按官方口径替换非法字符并截断到 32 字符；全非法输入退化为固定兜底名，
 * 保证结果始终合法且非空（官方要求 ≥1 字符）。
 */
export declare function normalizeServerName(name: string): string;
/** 运行宿主平台（默认 process.platform，单测可注入固定平台）。 */
type Platform = NodeJS.Platform | string;
/**
 * 把一条可粘贴的命令行解析为官方式可 spawn 的 {command, args}。
 * - Windows + .ps1 → powershell.exe -NoProfile -ExecutionPolicy Bypass -File <exec> <args>
 * - Windows + .cmd/.bat 或裸命令（npx/npm/任意全局 bin）→ cmd.exe /d /c <exec> <args>
 * - Windows + 显式 .exe / node → 直接 spawn
 * - Unix → 直接 spawn（launcher 可执行）
 * platform 默认 process.platform；单测传入可确定分支。
 */
export declare function resolveSpawnCommandLine(commandLine: string, platform?: Platform): {
    command: string;
    args: string[];
};
/**
 * 把 {command, args} 还原成一整行可粘贴的命令行（编辑表单回填用）。
 * 含空格的路径自动加双引号，保证再次经 splitCommandLine 切分仍是一个完整 token。
 */
export declare function renderCommandLine(command: string, args: string[]): string;
/** 解析 YAML 文本中的 MCP 行（托管区内 + 全文中 mcp-* 行）。 */
export declare function parseMcpRows(text: string): McpServerRow[];
/** 读取当前托管区（含全文中已有的 mcp-* 行）。 */
export declare function listMcpServers(): Promise<McpServerRow[]>;
/** 新建/更新一个 MCP 服务器（托管区 upsert）。 */
export declare function upsertMcpServer(input: unknown): Promise<McpServerRow>;
/** 删除一个 MCP 服务器。 */
export declare function removeMcpServer(nameOrId: string): Promise<{
    deleted: boolean;
}>;
/** 启用/停用一个 MCP 服务器。 */
export declare function toggleMcpServer(nameOrId: string, disabled: boolean): Promise<McpServerRow>;
export {};
