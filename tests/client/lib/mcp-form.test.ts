// tests/client/lib/mcp-form.test.ts
//
// MCP 表单纯逻辑单测（D11-09）：解析的是**用户粘贴的外部 mcp.json**，
// 属边界密集代码——解析错误会让用户点「保存」后写进 profile 的命令行不完整。
// 覆盖：mcpServers 包裹 / 单 server / serverName 回退 name / url 判定 transport /
// command+args 回拼一行（含空格与引号）/ env/headers 对象解析 / 失败 reason 语义 /
// 编辑回填与按传输方式收窄的提交负载。
//
// 运行环境：node（纯逻辑，不引入 jsdom）。

import { describe, expect, it } from 'vitest'
import {
  joinCommandLine,
  mcpFormFromJson,
  mcpFormFromServer,
  mcpServerPayload,
  parseJsonObject,
  type McpFormState,
} from '../../../src/client/lib/mcp-form.js'

/** 测试用表单草稿（逐字段显式，避免用例之间共享可变状态）。 */
function form(patch: Partial<McpFormState> = {}): McpFormState {
  return { serverName: '', transport: 'stdio', commandLine: '', env: '', headers: '', url: '', ...patch }
}

describe('mcpFormFromJson（粘贴官方 mcp.json → 表单草稿）', () => {
  it('mcpServers 包裹形态：取首个服务器，并以键名回退 serverName', () => {
    const result = mcpFormFromJson(JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'] },
      },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.form.serverName).toBe('filesystem')
    expect(result.form.transport).toBe('stdio')
    expect(result.form.commandLine).toBe('npx -y @modelcontextprotocol/server-filesystem /data')
  })

  it('serverName 存在时优先于 mcpServers 的键名', () => {
    const result = mcpFormFromJson(JSON.stringify({
      mcpServers: { keyName: { serverName: '显式名', command: 'node', args: ['server.js'] } },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.form.serverName).toBe('显式名')
  })

  it('单 server 对象（非 mcpServers 包裹）用 name 回退', () => {
    const result = mcpFormFromJson(JSON.stringify({ name: '单条', command: 'uvx', args: ['mcp-server-fetch'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.form.serverName).toBe('单条')
    expect(result.form.commandLine).toBe('uvx mcp-server-fetch')
  })

  it('含 url → transport=streamable-http，且不回填 commandLine（避免留下误导性命令行）', () => {
    const result = mcpFormFromJson(JSON.stringify({
      mcpServers: { remote: { url: 'https://example.com/mcp', command: 'ignored' } },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.form.transport).toBe('streamable-http')
    expect(result.form.url).toBe('https://example.com/mcp')
    expect(result.form.commandLine).toBe('')
  })

  it('transport 显式声明为 streamable-http 时同样按远程处理（即使没有 url）', () => {
    const result = mcpFormFromJson(JSON.stringify({ serverName: 'x', transport: 'streamable-http' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.form.transport).toBe('streamable-http')
  })

  it('env / headers 非空对象序列化进表单；空对象保持空串', () => {
    const result = mcpFormFromJson(JSON.stringify({
      serverName: 'x',
      command: 'node',
      env: { TOKEN: 'a' },
      headers: {},
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(result.form.env)).toEqual({ TOKEN: 'a' })
    expect(result.form.headers).toBe('')
  })

  it('空输入 → emptyInput；非法 JSON → invalidJson 且带解析器原文', () => {
    expect(mcpFormFromJson('   ')).toEqual({ ok: false, reason: 'emptyInput' })
    const invalid = mcpFormFromJson('{ not json')
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.reason).toBe('invalidJson')
    expect(typeof invalid.detail).toBe('string')
    expect((invalid.detail ?? '').length).toBeGreaterThan(0)
  })

  it('mcpServers 为空对象 → serversEmpty（不静默产出空表单）', () => {
    expect(mcpFormFromJson(JSON.stringify({ mcpServers: {} }))).toEqual({ ok: false, reason: 'serversEmpty' })
  })

  it('args 含空格的 token 回拼时加引号（粘贴回来的命令行仍可被正确切分）', () => {
    const result = mcpFormFromJson(JSON.stringify({
      mcpServers: { fs: { command: 'node', args: ['server.js', 'C:\\my data\\root', '--flag=a b'] } },
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.form.commandLine).toBe('node server.js "C:\\my data\\root" "--flag=a b"')
  })
})

describe('parseJsonObject（env / headers 文本解析）', () => {
  it('空串 → 空对象（未填即视为无该项）', () => {
    expect(parseJsonObject('')).toEqual({ ok: true, value: {} })
    expect(parseJsonObject('   ')).toEqual({ ok: true, value: {} })
  })

  it('对象文本 → 结构化结果；数组/标量/非法 JSON → invalid', () => {
    expect(parseJsonObject('{"A":"1"}')).toEqual({ ok: true, value: { A: '1' } })
    expect(parseJsonObject('[1,2]')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseJsonObject('123')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseJsonObject('{oops')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('joinCommandLine（command + args 回拼一整行）', () => {
  it('无空格 token 原样；含空格加双引号；同时含单双引号时转义双引号', () => {
    expect(joinCommandLine('npx', ['-y', 'pkg'])).toBe('npx -y pkg')
    expect(joinCommandLine('node', ['a b'])).toBe('node "a b"')
    expect(joinCommandLine('node', [`it's "x"`])).toBe('node "it\'s \\"x\\""')
  })

  it('空 command / 非数组 args 不抛错（边界输入）', () => {
    expect(joinCommandLine('', [])).toBe('')
    expect(joinCommandLine('node', undefined as unknown as string[])).toBe('node')
  })
})

describe('mcpFormFromServer / mcpServerPayload（编辑回填与提交收窄）', () => {
  it('回填：serverName 缺失时用 id；commandLine 缺失时用 command；空 env/headers 留空串', () => {
    const state = mcpFormFromServer({ id: 'srv-1', command: 'node server.js' })
    expect(state.id).toBe('srv-1')
    expect(state.serverName).toBe('srv-1')
    expect(state.transport).toBe('stdio')
    expect(state.commandLine).toBe('node server.js')
    expect(state.env).toBe('')
    expect(state.headers).toBe('')
  })

  it('stdio 提交：带 commandLine/env，不带 url/headers', () => {
    const payload = mcpServerPayload(form({ id: 'srv-1', serverName: 'fs', commandLine: 'node a.js' }), { env: { A: '1' }, headers: { H: 'x' } })
    expect(payload).toEqual({
      id: 'srv-1',
      serverName: 'fs',
      transport: 'stdio',
      commandLine: 'node a.js',
      env: { A: '1' },
      headers: undefined,
      url: undefined,
    })
  })

  it('streamable-http 提交：带 url/headers，不带 commandLine/env', () => {
    const payload = mcpServerPayload(
      form({ serverName: 'remote', transport: 'streamable-http', url: 'https://example.com/mcp' }),
      { env: { A: '1' }, headers: { Authorization: 'Bearer x' } },
    )
    expect(payload).toEqual({
      id: null,
      serverName: 'remote',
      transport: 'streamable-http',
      commandLine: undefined,
      env: undefined,
      headers: { Authorization: 'Bearer x' },
      url: 'https://example.com/mcp',
    })
  })

  it('空 env / headers 不写入负载（避免用空对象覆盖既有配置）', () => {
    const payload = mcpServerPayload(form({ serverName: 'fs', commandLine: 'node a.js' }), { env: {}, headers: {} })
    expect(payload.env).toBeUndefined()
    expect(payload.headers).toBeUndefined()
  })
})
