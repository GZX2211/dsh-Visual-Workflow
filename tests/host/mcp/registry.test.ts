// tests/host/mcp/registry.test.ts
// MCP 命令行解析与 serverName 规范化：shell 感知启动解析（npx/.cmd/.ps1 展开）、
// commandLine 回填往返、serverName 对齐官方字符集与长度约束。
// 纯函数单测，不依赖 harness；resolveSpawnCommandLine 通过 platform 参数固定分支。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeServerName, parseMcpRows, resolveSpawnCommandLine, renderCommandLine, toggleMcpServer, upsertMcpServer } from '../../../src/host/mcp/registry.js'
import { snapshotDshHome } from '../api/fixtures/api-harness.js'

describe('normalizeServerName：对齐官方 serverName 校验口径', () => {
  it('保留合法字符（字母/数字/下划线/连字符）并 trim', () => {
    expect(normalizeServerName('  demo_server-1 ')).toBe('demo_server-1')
  })

  it('含点等非法字符 → 替换为连字符（0.1.7-rc.1 官方正则只允许 [A-Za-z0-9_-]）', () => {
    expect(normalizeServerName('demo.server')).toBe('demo-server')
    expect(normalizeServerName('a b/c')).toBe('a-b-c')
  })

  it('超长名字截断到 32 字符', () => {
    expect(normalizeServerName('a'.repeat(40))).toBe('a'.repeat(32))
  })

  it('空 / 全非法输入 → 非空兜底名（官方要求长度 ≥1）', () => {
    expect(normalizeServerName('')).toBe('mcp')
    expect(normalizeServerName('   ')).toBe('mcp')
    expect(normalizeServerName('///')).toBe('---')
  })
})

describe('resolveSpawnCommandLine：shell 感知启动解析', () => {
  it('Windows + npx → 展开为 cmd.exe /d /c npx …', () => {
    const r = resolveSpawnCommandLine('npx -y @playwright/mcp@latest --headless', 'win32')
    expect(r.command).toBe('cmd.exe')
    expect(r.args).toEqual(['/d', '/c', 'npx', '-y', '@playwright/mcp@latest', '--headless'])
  })

  it('Windows + npm/yarn/pnpm/.cmd/.bat → 同样经 cmd.exe', () => {
    expect(resolveSpawnCommandLine('npm run serve', 'win32').command).toBe('cmd.exe')
    expect(resolveSpawnCommandLine('yarn dev', 'win32').command).toBe('cmd.exe')
    expect(resolveSpawnCommandLine('C:\\x\\foo.cmd a b', 'win32').command).toBe('cmd.exe')
  })

  it('Windows + 任意全局 bin（codegraph 等裸命令）→ 也经 cmd.exe', () => {
    const r = resolveSpawnCommandLine('codegraph serve --mcp', 'win32')
    expect(r.command).toBe('cmd.exe')
    expect(r.args).toEqual(['/d', '/c', 'codegraph', 'serve', '--mcp'])
  })

  it('Windows + node / node.exe → 直接 spawn（node.exe 真实可执行）', () => {
    expect(resolveSpawnCommandLine('node D:\\x\\cli.js', 'win32').command).toBe('node')
    expect(resolveSpawnCommandLine('node.exe --version', 'win32').command).toBe('node.exe')
    expect(resolveSpawnCommandLine('"C:\\Program Files\\nodejs\\node.exe" -v', 'win32').command).toBe('C:\\Program Files\\nodejs\\node.exe')
  })

  it('Windows + .ps1 → powershell.exe -File', () => {
    const r = resolveSpawnCommandLine('C:\\Users\\GZX\\AppData\\Roaming\\npm\\codegraph.ps1', 'win32')
    expect(r.command).toBe('powershell.exe')
    expect(r.args).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\Users\\GZX\\AppData\\Roaming\\npm\\codegraph.ps1'])
  })

  it('Unix + npx → 直接 npx（launcher 可执行，无需包装）', () => {
    const r = resolveSpawnCommandLine('npx -y demo-server', 'linux')
    expect(r.command).toBe('npx')
    expect(r.args).toEqual(['-y', 'demo-server'])
  })

  it('直接可执行（node / 绝对路径）→ 原样返回，不包装', () => {
    const node = resolveSpawnCommandLine('node C:\\app\\cli.js --port 9000', 'win32')
    expect(node.command).toBe('node')
    expect(node.args).toEqual(['C:\\app\\cli.js', '--port', '9000'])

    const space = resolveSpawnCommandLine('"C:\\Program Files\\nodejs\\node.exe" D:\\x\\cli.js', 'win32')
    expect(space.command).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(space.args).toEqual(['D:\\x\\cli.js'])
  })
})

describe('renderCommandLine：command + args → 整行回填', () => {
  it('无空格 token 直接拼接', () => {
    expect(renderCommandLine('cmd.exe', ['/d', '/c', 'npx', '-y', 'demo'])).toBe('cmd.exe /d /c npx -y demo')
  })

  it('含空格路径自动加双引号', () => {
    expect(renderCommandLine('C:\\Program Files\\nodejs\\node.exe', ['D:\\x\\cli.js'])).toBe('"C:\\Program Files\\nodejs\\node.exe" D:\\x\\cli.js')
  })

  it('与 resolveSpawnCommandLine 往返：解析→回填→再解析一致', () => {
    const line = 'npx -y @playwright/mcp@latest --headless'
    const resolved = resolveSpawnCommandLine(line, 'win32')
    const rendered = renderCommandLine(resolved.command, resolved.args)
    // 回填后的整行再次解析仍得到同一可 spawn 结构（幂等，不二次包装）
    const again = resolveSpawnCommandLine(rendered, 'win32')
    expect(again).toEqual(resolved)
  })
})

// ---------------------------------------------------------------------------
// 写入安全与托管区往返（D01-01 / D01-02）：id 严格校验 + YAML 转义 + headers 双形态
// ---------------------------------------------------------------------------

const restoreDshHome = snapshotDshHome()

afterEach(() => {
  restoreDshHome()
})

/** 建一个临时 DSH_HOME（web profile 由 upsert 自行创建）。 */
async function useTempDshHome(): Promise<{ root: string; patch: string }> {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'vw-mcp-'))
  process.env.DSH_HOME = root
  return { root, patch: join(root, 'profiles', 'web', 'cordis.patch.yml') }
}

describe('MCP 写入安全：id 严格校验 + YAML 转义（D01-01）', () => {
  it('非法 id（换行注入 / 冒号 / 引号 / 空串）被拒绝，且不写盘', async () => {
    const { root, patch } = await useTempDshHome()
    const badIds = [
      'mcp-x\n- insert:\n    - id: evil\n      name: "/tmp/evil.mjs"',
      'mcp-has:colon',
      'mcp-quote\'x',
      'mcp-x y',
      '',
    ]
    for (const id of badIds) {
      await expect(
        upsertMcpServer({ id, serverName: 'demo', transport: 'stdio', commandLine: 'node a.js' }),
        `非法 id 必须被拒绝：${JSON.stringify(id)}`,
      ).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    }
    // 拒绝发生在落盘之前：不留下任何 patch 文件（宿主配置不被污染）
    await expect(readFile(patch, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(root, { recursive: true, force: true })
  })

  it('合法 id 往返不变，且写入形态为带引号的 YAML 标量（yamlScalar 双保险）', async () => {
    const { root, patch } = await useTempDshHome()
    const saved = await upsertMcpServer({ id: 'mcp-demo', serverName: 'demo', transport: 'stdio', commandLine: 'node a.js' })
    expect(saved.id).toBe('mcp-demo')
    const text = await readFile(patch, 'utf8')
    // ② 输出侧：id 一律单引号包裹（与 name 同口径），不再是裸标量
    expect(text).toContain("- id: 'mcp-demo'")
    // 反解析兼容：带引号形态仍能读回同一 id（parseMcpRows 剥离首尾引号）
    const rows = parseMcpRows(text)
    expect(rows.map((row) => row.id)).toEqual(['mcp-demo'])
    // 裸 serverName 也走 normalizeMcpId 补前缀，同样合法
    const bare = await upsertMcpServer({ serverName: 'demo2', transport: 'stdio', commandLine: 'node b.js' })
    expect(bare.id).toBe('mcp-demo2')
    await rm(root, { recursive: true, force: true })
  })
})

describe('MCP headers 往返：解析两种书写形态（D01-02 读侧）', () => {
  it('parseMcpRows：inline JSON 与缩进对象两种形态的 headers 都可读回', () => {
    const inline = [
      '# >>> dsh-visual-workflow',
      '- insert:',
      "    - id: 'mcp-http'",
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      "        serverName: 'http'",
      "        transport: 'streamable-http'",
      "        url: 'https://x/mcp'",
      '        headers: {"Authorization":"Bearer secret","X-Trace":"1"}',
      '# <<< dsh-visual-workflow',
    ].join('\n')
    const [row] = parseMcpRows(inline)
    expect(row?.id).toBe('mcp-http')
    expect(row?.headers).toEqual({ Authorization: 'Bearer secret', 'X-Trace': '1' })

    const block = [
      '# >>> dsh-visual-workflow',
      '- insert:',
      "    - id: 'mcp-http2'",
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      "        serverName: 'http2'",
      "        transport: 'streamable-http'",
      "        url: 'https://y/mcp'",
      '        headers:',
      '          Authorization: Bearer block-secret',
      '          X-Trace: 2',
      "        transport_note: 'headers 块结束后的同级键仍被正确解析'",
      '# <<< dsh-visual-workflow',
    ].join('\n')
    const [blockRow] = parseMcpRows(block)
    expect(blockRow?.headers).toEqual({ Authorization: 'Bearer block-secret', 'X-Trace': '2' })
    // 嵌套块结束后，同级键回到 config 顶层（深度跟踪正确复位）
    expect(blockRow?.transport).toBe('streamable-http')
  })
})

// ---------------------------------------------------------------------------
// 托管区写回的禁用清单口径：三条写路径共用同一实现
// ---------------------------------------------------------------------------

/** 托管区内的 insert 行数（数组元素个数）。 */
function insertCount(text: string): number {
  return text.split('- insert:').length - 1
}

describe('MCP 托管区：禁用清单写回口径', () => {
  it('切换一个服务器的 disabled：另一个 streamable-http 服务器的 headers 仍在磁盘上', async () => {
    const { root, patch } = await useTempDshHome()
    await upsertMcpServer({
      id: 'mcp-http',
      serverName: 'http',
      transport: 'streamable-http',
      url: 'https://x/mcp',
      headers: { Authorization: 'Bearer secret' },
    })
    await upsertMcpServer({ id: 'mcp-stdio', serverName: 'stdio', transport: 'stdio', commandLine: 'node a.js' })

    await toggleMcpServer('mcp-stdio', true)

    const text = await readFile(patch, 'utf8')
    const rows = parseMcpRows(text)
    expect(rows.find((row) => row.id === 'mcp-stdio')?.disabled).toBe(true)
    expect(rows.find((row) => row.id === 'mcp-http')?.disabled).toBe(false)
    // 未被触碰的服务器：凭据仍在磁盘上，且结构没被破坏（仍是两个 insert 行）
    expect(rows.find((row) => row.id === 'mcp-http')?.headers).toEqual({ Authorization: 'Bearer secret' })
    expect(insertCount(text)).toBe(2)
    await rm(root, { recursive: true, force: true })
  })

  it('再次 upsert 已停用的服务器：停用态保留，禁用清单仍只写 disabled 行', async () => {
    const { root, patch } = await useTempDshHome()
    await upsertMcpServer({ id: 'mcp-a', serverName: 'a', transport: 'stdio', commandLine: 'node a.js' })
    await upsertMcpServer({ id: 'mcp-b', serverName: 'b', transport: 'stdio', commandLine: 'node b.js' })
    await toggleMcpServer('mcp-a', true)

    await upsertMcpServer({ id: 'mcp-b', serverName: 'b', transport: 'stdio', commandLine: 'node b.js --flag' })

    const rows = parseMcpRows(await readFile(patch, 'utf8'))
    expect(rows.find((row) => row.id === 'mcp-a')?.disabled).toBe(true)
    expect(rows.find((row) => row.id === 'mcp-b')?.disabled).toBe(false)
    // 重新 upsert 的 commandLine 生效：args 里带上了新参数
    expect(rows.find((row) => row.id === 'mcp-b')?.args).toContain('--flag')
    expect(insertCount(await readFile(patch, 'utf8'))).toBe(2)
    await rm(root, { recursive: true, force: true })
  })

  it('启停往返：toggle(false) 后禁用清单被清空，行仍可读回', async () => {
    const { root, patch } = await useTempDshHome()
    await upsertMcpServer({ id: 'mcp-a', serverName: 'a', transport: 'stdio', commandLine: 'node a.js' })
    await toggleMcpServer('mcp-a', true)
    await toggleMcpServer('mcp-a', false)

    const text = await readFile(patch, 'utf8')
    const rows = parseMcpRows(text)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.disabled).toBe(false)
    // 启用态不写禁用行（写盘口径：只出现 disabled 行）
    expect(text).not.toContain('disabled: true')
    await rm(root, { recursive: true, force: true })
  })
})
