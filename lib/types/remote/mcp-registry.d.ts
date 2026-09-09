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
