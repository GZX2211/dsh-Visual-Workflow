/** MCP 表单编辑态（组件本地草稿；与后端 server 对象字段口径一致）。 */
export interface McpFormState {
    id?: string;
    serverName: string;
    transport: string;
    commandLine: string;
    env: string;
    headers: string;
    url: string;
}
/** 后端 MCP 服务器条目（组件消费的最小形状）。 */
export interface McpServerEntry {
    id: string;
    serverName?: string;
    transport?: string;
    command?: string;
    args?: string[];
    commandLine?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    url?: string;
    disabled?: boolean;
    description?: string;
}
/** 把 {command, args} 拼回一整行（含空格的 token 加引号），供导入时回填 commandLine。 */
export declare function joinCommandLine(command: string, args: string[]): string;
/** env / headers 文本解析结果（失败不带文案：调用方按 reason 映射词典）。 */
export type JsonObjectResult = {
    ok: true;
    value: Record<string, string>;
} | {
    ok: false;
    reason: 'invalid';
};
/** 解析 env / headers 的 JSON 字符串为对象（空串 → {}）。 */
export declare function parseJsonObject(text: string): JsonObjectResult;
/** mcp.json 导入结果（失败 reason 由调用方映射词典；invalidJson 可展示解析器原文）。 */
export type McpImportResult = {
    ok: true;
    form: McpFormState;
} | {
    ok: false;
    reason: 'emptyInput' | 'serversEmpty' | 'invalidJson';
    detail?: string;
};
/**
 * 从粘贴的 mcp.json 文本生成表单草稿：
 * 支持 {mcpServers:{name:{...}}}（取首个）或单个 server 对象。
 */
export declare function mcpFormFromJson(raw: string): McpImportResult;
/** 编辑既有服务器 → 表单草稿（列表「编辑」入口）。 */
export declare function mcpFormFromServer(server: McpServerEntry): McpFormState;
/** 新建服务器的空表单。 */
export declare function emptyMcpForm(): McpFormState;
/**
 * 表单 → 后端 server 负载（按传输方式收窄字段：stdio 用 commandLine/env，
 * streamable-http 用 url/headers；空对象不写入）。
 */
export declare function mcpServerPayload(form: McpFormState, parsed: {
    env: Record<string, string>;
    headers: Record<string, string>;
}): Record<string, unknown>;
