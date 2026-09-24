// src/client/lib/mcp-form.ts
//
// MCP 服务器表单的纯逻辑：命令行拼装/回填、env/headers JSON 解析、mcp.json 导入投影。
// 从 ComboManager 组件下沉（组件不应承载解析与投影），且不抛用户可见文案——
// 失败以结构化 reason 返回，由调用方映射词典。

/** MCP 表单编辑态（组件本地草稿；与后端 server 对象字段口径一致）。 */
export interface McpFormState {
  id?: string
  serverName: string
  transport: string
  commandLine: string
  env: string
  headers: string
  url: string
}

/** 后端 MCP 服务器条目（组件消费的最小形状）。 */
export interface McpServerEntry {
  id: string
  serverName?: string
  transport?: string
  command?: string
  args?: string[]
  commandLine?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  url?: string
  disabled?: boolean
  description?: string
}

/** 把 {command, args} 拼回一整行（含空格的 token 加引号），供导入时回填 commandLine。 */
export function joinCommandLine(command: string, args: string[]): string {
  return [String(command ?? ''), ...(Array.isArray(args) ? args : []).map((arg) => String(arg))]
    .filter((token) => token !== '')
    .map((token) => {
      if (/^[A-Za-z0-9_./\\:=@%+,\[\]{}#-]+$/.test(token) && !/["']/.test(token)) return token
      if (!token.includes('"')) return `"${token}"`
      if (!token.includes("'")) return `'${token}'`
      return `"${token.replace(/"/g, '\\"')}"`
    })
    .join(' ')
}

/** env / headers 文本解析结果（失败不带文案：调用方按 reason 映射词典）。 */
export type JsonObjectResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; reason: 'invalid' }

/** 解析 env / headers 的 JSON 字符串为对象（空串 → {}）。 */
export function parseJsonObject(text: string): JsonObjectResult {
  const value = String(text ?? '').trim()
  if (!value) return { ok: true, value: {} }
  try {
    const obj = JSON.parse(value)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return { ok: true, value: obj as Record<string, string> }
  } catch {
    // 落入统一失败结果
  }
  return { ok: false, reason: 'invalid' }
}

/** mcp.json 导入结果（失败 reason 由调用方映射词典；invalidJson 可展示解析器原文）。 */
export type McpImportResult =
  | { ok: true; form: McpFormState }
  | { ok: false; reason: 'emptyInput' | 'serversEmpty' | 'invalidJson'; detail?: string }

/**
 * 从粘贴的 mcp.json 文本生成表单草稿：
 * 支持 {mcpServers:{name:{...}}}（取首个）或单个 server 对象。
 */
export function mcpFormFromJson(raw: string): McpImportResult {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, reason: 'emptyInput' }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch (error) {
    return { ok: false, reason: 'invalidJson', detail: error instanceof Error ? error.message : String(error) }
  }
  if (data && typeof data === 'object' && data.mcpServers && typeof data.mcpServers === 'object') {
    const entries = Object.entries(data.mcpServers as Record<string, unknown>)
    if (entries.length === 0) return { ok: false, reason: 'serversEmpty' }
    const [name, server] = entries[0]
    data = { ...(server as Record<string, unknown>), serverName: (server as Record<string, unknown>)?.serverName ?? name } as Record<string, unknown>
  }
  const transport = data.transport === 'streamable-http' || data.url ? 'streamable-http' : 'stdio'
  const command = String(data.command ?? '')
  const args = Array.isArray(data.args) ? (data.args as unknown[]).map((item) => String(item)) : []
  return {
    ok: true,
    form: {
      id: undefined,
      serverName: String((data.serverName as string) ?? (data.name as string) ?? ''),
      transport,
      commandLine: transport === 'stdio' ? joinCommandLine(command, args) : '',
      env: data.env && typeof data.env === 'object' && Object.keys(data.env as object).length > 0 ? JSON.stringify(data.env) : '',
      headers: data.headers && typeof data.headers === 'object' && Object.keys(data.headers as object).length > 0 ? JSON.stringify(data.headers) : '',
      url: String(data.url ?? ''),
    },
  }
}

/** 编辑既有服务器 → 表单草稿（列表「编辑」入口）。 */
export function mcpFormFromServer(server: McpServerEntry): McpFormState {
  const name = String(server.serverName ?? '').trim() || String(server.id ?? '')
  return {
    id: server.id,
    serverName: name,
    transport: server.transport ?? 'stdio',
    commandLine: String(server.commandLine ?? server.command ?? ''),
    env: server.env && Object.keys(server.env).length > 0 ? JSON.stringify(server.env) : '',
    headers: server.headers && Object.keys(server.headers).length > 0 ? JSON.stringify(server.headers) : '',
    url: server.url ?? '',
  }
}

/** 新建服务器的空表单。 */
export function emptyMcpForm(): McpFormState {
  return { serverName: '', transport: 'stdio', commandLine: '', env: '', headers: '', url: '' }
}

/**
 * 表单 → 后端 server 负载（按传输方式收窄字段：stdio 用 commandLine/env，
 * streamable-http 用 url/headers；空对象不写入）。
 */
export function mcpServerPayload(form: McpFormState, parsed: { env: Record<string, string>; headers: Record<string, string> }): Record<string, unknown> {
  const stdio = form.transport === 'stdio'
  return {
    id: form.id ?? null,
    serverName: form.serverName,
    transport: form.transport,
    commandLine: stdio ? form.commandLine : undefined,
    env: stdio && Object.keys(parsed.env).length > 0 ? parsed.env : undefined,
    headers: !stdio && Object.keys(parsed.headers).length > 0 ? parsed.headers : undefined,
    url: !stdio ? form.url : undefined,
  }
}
