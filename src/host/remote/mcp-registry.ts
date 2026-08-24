// src/host/remote/mcp-registry.ts
//
// MCP 服务器注册表：行托管在 profile 的 cordis.patch.yml 内，用注释标记的托管区
// 隔离（# >>> dsh-visual-workflow ... # <<< dsh-visual-workflow），行结构与官方
// dsh-mcp-client 一致（mcp-* id），工具公开名 mcp__<serverName>__<tool>。
// 修改后需重启 dsh web 生效。profile 定位：$DSH_HOME/profiles/<profile>/cordis.patch.yml。

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

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
      if (entry.startsWith('.')) continue
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

function renderConfig(config: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`        ${key}:`)
      for (const item of value) lines.push(`          - ${JSON.stringify(String(item))}`)
    } else if (typeof value === 'object') {
      lines.push(`        ${key}: ${JSON.stringify(value)}`)
    } else {
      lines.push(`        ${key}: ${JSON.stringify(value)}`)
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
  const temporary = `${patch}.${process.pid}.tmp`
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
  } else {
    const split = splitCommandLine(String(input.command ?? ''))
    if (!split.command) throw new Error('stdio 服务器需要 command')
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
