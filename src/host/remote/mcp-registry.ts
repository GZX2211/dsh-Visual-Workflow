// src/host/remote/mcp-registry.ts
//
// MCP 服务器注册表：行托管在 profile 的 cordis.patch.yml 内，用注释标记的托管区
// 隔离（# >>> dsh-visual-workflow ... # <<< dsh-visual-workflow），行结构与官方
// dsh-mcp-client 一致（mcp-* id），工具公开名 mcp__<serverName>__<tool>。
// 修改后需重启 dsh web 生效。profile 定位：$DSH_HOME/profiles/<profile>/cordis.patch.yml。

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'
const START = '# >>> dsh-visual-workflow'
const END = '# <<< dsh-visual-workflow'

export interface McpServerRow {
  id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  env: Record<string, string>
  headers: Record<string, string>
  url: string
  disabled: boolean
}

function dshHome(): string {
  const env = process.env.DSH_HOME
  if (env && env.trim() !== '') return env
  return join(homedir(), '.dsh')
}

/** 定位 profile 的 cordis.patch.yml（优先 "web"，回退第一个含该文件的 profile 目录）。 */
export function hostPatchPath(): string {
  const profilesRoot = join(dshHome(), 'profiles')
  const candidates: string[] = []
  try {
    for (const entry of readdirSync(profilesRoot)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      const path = join(profilesRoot, entry)
      try {
        if (statSync(path).isDirectory()) candidates.push(entry)
      } catch {
        // 忽略
      }
    }
  } catch {
    candidates.push('web')
  }
  if (candidates.length === 0) candidates.push('web')
  // 明确优先 web profile（注释约定的首选运行面），避免 readdir 顺序把 headless
  // 排到 web 前面时读到空 patch，导致组合管理页看不到 MCP 服务器。
  const webPatch = join(profilesRoot, 'web', 'cordis.patch.yml')
  try {
    statSync(webPatch)
    return webPatch
  } catch {
    // web 不存在时再回退到第一个含 patch 的 profile
  }
  for (const name of candidates) {
    const patch = join(profilesRoot, name, 'cordis.patch.yml')
    try {
      statSync(patch)
      return patch
    } catch {
      // 继续
    }
  }
  return join(profilesRoot, candidates[0], 'cordis.patch.yml')
}

function normalizeMcpId(nameOrId: string): string {
  const value = String(nameOrId ?? '').trim()
  return value.startsWith('mcp-') ? value : `mcp-${value}`
}

function normalizeServerName(name: string): string {
  return String(name ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '-')
}

/** 命令行拆分（引号感知）：可执行名与参数分离（MCP SDK 把 command 当可执行名）。 */
function splitCommandLine(commandLine: string): { command: string; args: string[] } {
  const line = String(commandLine ?? '').trim()
  if (!line) return { command: '', args: [] }
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let tokenStarted = false
  for (const char of line) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      tokenStarted = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }
    current += char
    tokenStarted = true
  }
  if (tokenStarted) tokens.push(current)
  if (tokens.length === 0) return { command: '', args: [] }
  return { command: tokens[0], args: tokens.slice(1) }
}

// ---------------------------------------------------------------------------
// shell 感知的启动解析（让「一条可粘贴的命令行」直接可用）
// ---------------------------------------------------------------------------
// 官方 dsh-mcp-client 的 stdio 传输用「非 shell」的 child_process.spawn。Windows
// 下 npx/npm/yarn/pnpm 是 .cmd/.ps1 包装、.ps1 也不是可执行体，Node ≥ 20.12 因
// CVE-2024-27980 加固拒绝直接 spawn .cmd/.bat，实测 spawn('npx') → ENOENT。因此
// 保存时把这类 launcher 展开成 cmd.exe /c …（或 powershell -File …），使官方
// 传输能真正拉起进程；Unix 下 launcher 本身可执行，直接 spawn 即可。

/** 运行宿主平台（默认 process.platform，单测可注入固定平台）。 */
type Platform = NodeJS.Platform | string

/**
 * 判断某条命令在目标平台是否需要 shell 包装。
 * Windows 下很多「命令」其实是 .cmd/.ps1 包装（npx、任意 npm 全局 bin 如 codegraph），
 * MCP SDK 的 stdio 用非 shell spawn 直接拉起会失败（Node≥20.12 对 .cmd/.bat 有
 * CVE-2024-27980 加固，spawn('npx') → ENOENT）。规则：
 *  - .ps1 → powershell.exe -File（包装）
 *  - .cmd/.bat → cmd.exe /c（包装）
 *  - 显式 .exe（含完整路径 + .exe）→ 直接 spawn
 *  - node / node.exe → 直接 spawn（node.exe 是真实可执行，spawn('node') 实测可用）
 *  - 其余裸命令（npx/npm/yarn/pnpm/任意全局 bin）→ 一律 cmd.exe /c，保证任一全局工具可拉起
 * Unix 下无需包装（launcher 本身可执行），直接 spawn。
 */
function needsShellWrap(exec: string, platform: Platform): boolean {
  if (String(platform) !== 'win32') return false
  const lower = String(exec).toLowerCase()
  if (/\.ps1$/i.test(lower)) return true
  if (/\.(cmd|bat)$/i.test(lower)) return true
  if (/\.exe$/i.test(lower)) return false
  const base = basename(lower)
  if (base === 'node' || base === 'node.exe') return false
  return true
}

/**
 * 把一条可粘贴的命令行解析为官方式可 spawn 的 {command, args}。
 * - Windows + .ps1 → powershell.exe -NoProfile -ExecutionPolicy Bypass -File <exec> <args>
 * - Windows + .cmd/.bat 或裸命令（npx/npm/任意全局 bin）→ cmd.exe /d /c <exec> <args>
 * - Windows + 显式 .exe / node → 直接 spawn
 * - Unix → 直接 spawn（launcher 可执行）
 * platform 默认 process.platform；单测传入可确定分支。
 */
export function resolveSpawnCommandLine(commandLine: string, platform: Platform = process.platform): { command: string; args: string[] } {
  const split = splitCommandLine(commandLine)
  if (!split.command) return { command: '', args: [] }
  const exec = split.command
  const rest = split.args
  if (needsShellWrap(exec, platform)) {
    if (/\.ps1$/i.test(exec)) {
      return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', exec, ...rest] }
    }
    return { command: 'cmd.exe', args: ['/d', '/c', exec, ...rest] }
  }
  return { command: exec, args: rest }
}

/** 单个 shell token 加引号：token 含空格/引号等才包裹，便于回填后再次切分。 */
function quoteShellToken(token: string): string {
  const value = String(token)
  // 无空格、无引号、无非 ASCII 空白的「安全 token」无需引号（反斜杠在 Windows 路径里是字面量，不转义）
  if (/^[A-Za-z0-9_./\\:=@%+,\[\]{}#-]+$/.test(value) && !/["']/.test(value)) return value
  // 含空格/特殊字符：用双引号包裹。splitCommandLine 不做反斜杠转义，故不 double 反斜杠；
  // 若 token 本身含双引号，则回退单引号；两者都有才反转义双引号。
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * 把 {command, args} 还原成一整行可粘贴的命令行（编辑表单回填用）。
 * 含空格的路径自动加双引号，保证再次经 splitCommandLine 切分仍是一个完整 token。
 */
export function renderCommandLine(command: string, args: string[]): string {
  const tokens = [String(command), ...(Array.isArray(args) ? args : []).map((arg) => String(arg))]
  return tokens.filter((token) => token !== '').map(quoteShellToken).join(' ')
}

/** 解析 YAML 文本中的 MCP 行（托管区内 + 全文中 mcp-* 行）。 */
export function parseMcpRows(text: string): McpServerRow[] {
  const rows = new Map<string, { config: Record<string, unknown> }>()
  const toggles = new Map<string, boolean>()
  const lines = String(text ?? '').split(/\r?\n/)
  let current: { insert?: boolean; id?: string; name?: string; config?: Record<string, unknown>; lastArrayKey?: string | null; envDepth?: number; disabled?: boolean } | null = null
  const push = (): void => {
    if (current && current.insert && current.id && current.name === MCP_CLIENT) {
      rows.set(current.id, { config: current.config ?? {} })
    }
    if (current && !current.insert && current.id && current.disabled !== undefined) {
      toggles.set(current.id, current.disabled === true)
    }
  }
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (indent === 0 && trimmed.startsWith('- insert:')) {
      push()
      current = { insert: true }
      continue
    }
    if (indent === 0 && trimmed.startsWith('- id:')) {
      push()
      current = { id: trimmed.replace(/^- id:\s*/, '').replace(/^["']|["']$/g, '') }
      continue
    }
    if (!current) continue
    if (current.insert && indent >= 2 && trimmed.startsWith('- id:')) {
      current.id = trimmed.replace(/^- id:\s*/, '').replace(/^["']|["']$/g, '')
      continue
    }
    if (current.insert && indent >= 8 && trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim().replace(/^["']|["']$/g, '')
      if (current.lastArrayKey && current.config) {
        current.config[current.lastArrayKey] = [...(current.config[current.lastArrayKey] as string[] ?? []), item]
      }
      continue
    }
    if (current.insert && current.envDepth !== undefined && indent > current.envDepth) {
      const kv = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
      if (kv) {
        if (!current.config) current.config = {}
        if (!current.config.env || typeof current.config.env !== 'object') current.config.env = {}
        ;(current.config.env as Record<string, string>)[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
      }
      continue
    }
    const match = trimmed.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    const value = rawValue.replace(/^["']|["']$/g, '')
    if (current.insert && current.envDepth !== undefined && indent <= current.envDepth) {
      current.envDepth = undefined
      current.lastArrayKey = null
    }
    if (indent >= 6 && current.insert && ['serverName', 'transport', 'command', 'url'].includes(key)) {
      if (!current.config) current.config = {}
      current.config[key] = value
      current.lastArrayKey = null
    } else if (indent >= 6 && current.insert && key === 'args') {
      if (!current.config) current.config = {}
      current.config.args = []
      current.lastArrayKey = 'args'
    } else if (indent >= 6 && current.insert && key === 'env') {
      if (!current.config) current.config = {}
      if (rawValue.trim().startsWith('{')) {
        try {
          current.config.env = JSON.parse(rawValue) as Record<string, string>
        } catch {
          current.config.env = {}
        }
        current.lastArrayKey = null
      } else {
        current.config.env = {}
        current.envDepth = indent
        current.lastArrayKey = null
      }
    } else if (indent >= 4 && current.insert && key === 'name') {
      current.name = value
      current.lastArrayKey = null
    } else if (indent >= 4 && current.insert && key === 'id') {
      current.id = value
      current.lastArrayKey = null
    } else if (indent >= 2 && !current.insert && key === 'disabled') {
      current.disabled = value === 'true'
    }
  }
  push()
  return [...rows.entries()].map(([id, row]) => {
    const config = row.config
    return {
      id,
      serverName: String(config.serverName ?? id.replace(/^mcp-/, '')),
      transport: config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
      command: String(config.command ?? ''),
      args: Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
      env: (config.env ?? {}) as Record<string, string>,
      headers: (config.headers ?? {}) as Record<string, string>,
      url: String(config.url ?? ''),
      disabled: toggles.get(id) ?? false,
    }
  })
}

/** 读取当前托管区（含全文中已有的 mcp-* 行）。 */
export async function listMcpServers(): Promise<McpServerRow[]> {
  const patch = hostPatchPath()
  let text = ''
  try {
    text = await readFile(patch, 'utf8')
  } catch {
    return []
  }
  return parseMcpRows(text)
}

function renderRegion(rows: McpServerRow[], toggles: Array<[string, boolean]>): string {
  const body = rows
    .map((row) => {
      const config: Record<string, unknown> = { serverName: row.serverName, transport: row.transport ?? 'stdio' }
      if ((row.transport ?? 'stdio') === 'streamable-http') {
        if (row.url) config.url = row.url
      } else {
        if (row.command) config.command = row.command
        if (Array.isArray(row.args) && row.args.length > 0) config.args = row.args
        if (row.env && typeof row.env === 'object' && Object.keys(row.env).length > 0) config.env = row.env
      }
      return `- insert:\n    - id: ${row.id}\n      name: '${MCP_CLIENT}'\n      config:${renderConfig(config)}`
    })
    .join('\n')
  const toggleLines = toggles.map(([id, disabled]) => `- id: ${id}\n  disabled: ${disabled}`)
  const content = [...(body ? [body] : []), ...toggleLines].join('\n')
  return content ? `${START}\n${content}\n${END}` : ''
}

/**
 * YAML 单引号字符串转义（单引号内反斜杠为字面量，只有 ' 需翻倍）。
 * 为什么不用 JSON.stringify：双引号包裹时反斜杠需成对转义，写盘文件里
 * 出现 16 层反斜杠（双重转义事故），MCP 命令路径解析错误导致工具无法加载。
 */
function yamlScalar(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function renderConfig(config: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`        ${key}:`)
      for (const item of value) lines.push(`          - ${yamlScalar(String(item))}`)
    } else if (typeof value === 'object') {
      if (Object.keys(value as Record<string, unknown>).length === 0) continue
      lines.push(`        ${key}: ${JSON.stringify(value)}`)
    } else {
      lines.push(`        ${key}: ${yamlScalar(String(value))}`)
    }
  }
  return lines.length ? `\n${lines.join('\n')}` : ' {}'
}

/** 写回托管区（读全文件 → 替换 region → 原子写）。 */
async function writeRegion(nextRows: McpServerRow[], nextToggles: Array<[string, boolean]>): Promise<void> {
  const patch = hostPatchPath()
  await mkdir(dirname(patch), { recursive: true })
  let text = ''
  try {
    text = await readFile(patch, 'utf8')
  } catch {
    text = ''
  }
  const startIdx = text.indexOf(START)
  const endIdx = text.indexOf(END, startIdx >= 0 ? startIdx : 0)
  let head = text
  let tail = ''
  if (startIdx >= 0 && endIdx >= startIdx) {
    head = text.slice(0, startIdx).replace(/\s*$/, '\n')
    tail = text.slice(endIdx + END.length)
  } else if (text.trim() === '') {
    head = ''
    tail = ''
  } else {
    head = text.replace(/\s*$/, '\n')
    tail = ''
  }
  // DSH 生成的 patch 顶层可能是空数组占位 `[]`：托管区条目须成为顶层数组内容
  head = head.replace(/\[\]\s*$/, '')
  const region = renderRegion(nextRows, nextToggles) || '[]'
  const next = [head.trimEnd(), region, tail.replace(/^\s+/, '')].filter((part) => part !== '').join('\n') + '\n'
  // 临时名含 pid + 随机后缀：并发 upsert/remove/toggle（GUI 串行为主，但同一
  // profile patch 的双写竞态理论上存在）时各写独立临时文件，rename 源互不干扰
  const temporary = `${patch}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, next, 'utf8')
  await rename(temporary, patch)
}

function validateEntry(input: Record<string, unknown>): { id: string; config: Record<string, unknown> } {
  const serverName = normalizeServerName(String(input.serverName ?? ''))
  if (!serverName) throw new Error('MCP 服务器名称不能为空')
  const transport = input.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const config: Record<string, unknown> = { serverName, transport }
  if (transport === 'streamable-http') {
    if (!String(input.url ?? '').trim()) throw new Error('streamable-http 服务器需要 url')
    config.url = String(input.url).trim()
    if (input.headers && typeof input.headers === 'object') config.headers = input.headers
  } else {
    // 优先整行可粘贴的 commandLine，其次旧的 command（+ args）字段
    const raw = String(input.commandLine ?? input.command ?? '').trim()
    const split = resolveSpawnCommandLine(raw)
    if (!split.command) throw new Error('stdio 服务器需要 command 或 commandLine')
    config.command = split.command
    const explicitArgs = Array.isArray(input.args) ? input.args.map((v) => String(v)) : []
    config.args = [...split.args, ...explicitArgs]
    if (input.env && typeof input.env === 'object') config.env = input.env
  }
  return { id: normalizeMcpId(String(input.id ?? serverName)), config }
}

/** 新建/更新一个 MCP 服务器（托管区 upsert）。 */
export async function upsertMcpServer(input: unknown): Promise<McpServerRow> {
  const entry = validateEntry((input ?? {}) as Record<string, unknown>)
  const existing = await listMcpServers()
  const next = existing.filter((row) => row.id !== entry.id)
  next.push({
    id: entry.id,
    serverName: String(entry.config.serverName),
    transport: entry.config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: String(entry.config.command ?? ''),
    args: Array.isArray(entry.config.args) ? entry.config.args.map((item) => String(item)) : [],
    env: (entry.config.env ?? {}) as Record<string, string>,
    headers: (entry.config.headers ?? {}) as Record<string, string>,
    url: String(entry.config.url ?? ''),
    disabled: existing.find((row) => row.id === entry.id)?.disabled ?? false,
  })
  await writeRegion(next, next.filter((row) => row.disabled).map((row) => [row.id, true] as [string, boolean]))
  return next.find((row) => row.id === entry.id)!
}

/** 删除一个 MCP 服务器。 */
export async function removeMcpServer(nameOrId: string): Promise<{ deleted: boolean }> {
  const id = normalizeMcpId(nameOrId)
  const existing = await listMcpServers()
  const next = existing.filter((row) => row.id !== id)
  if (next.length === existing.length) return { deleted: false }
  await writeRegion(next, next.filter((row) => row.disabled).map((row) => [row.id, true] as [string, boolean]))
  return { deleted: true }
}

/** 启用/停用一个 MCP 服务器。 */
export async function toggleMcpServer(nameOrId: string, disabled: boolean): Promise<McpServerRow> {
  const id = normalizeMcpId(nameOrId)
  const existing = await listMcpServers()
  const found = existing.find((row) => row.id === id)
  if (!found) throw new Error(`MCP 服务器不存在：${id}`)
  const next = existing.map((row) => (row.id === id ? { ...row, disabled: disabled !== false } : row))
  await writeRegion(next, next.filter((row) => row.disabled).map((row) => [row.id, true] as [string, boolean]))
  return next.find((row) => row.id === id)!
}
