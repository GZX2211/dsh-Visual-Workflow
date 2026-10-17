// tests/host/mcp/registry.test.ts
// MCP 命令行解析与 serverName 规范化：shell 感知启动解析（npx/.cmd/.ps1 展开）、
// commandLine 回填往返、serverName 对齐官方字符集与长度约束。
// 纯函数单测，不依赖 harness；resolveSpawnCommandLine 通过 platform 参数固定分支。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { normalizeServerName, parseMcpRows, removeMcpServer, resolveSpawnCommandLine, renderCommandLine, toggleMcpServer, upsertMcpServer } from '../../../src/host/mcp/registry.js'
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

// ---------------------------------------------------------------------------
// 写路径错误契约（IF-1）：领域只抛稳定 code，HTTP 状态映射归 api 边界
// （400 / 404 的映射由 tests/host/api/catalog.test.ts 经路由锁定）
// ---------------------------------------------------------------------------

/** 捕获拒绝值：同时取稳定 code 与界面可见文案（裸 Error 无 code，会暴露为 undefined）。 */
async function capturedError(run: () => Promise<unknown>): Promise<{ code?: string; message?: string } | null> {
  return run().then(() => null, (error: unknown) => error as { code?: string; message?: string })
}

describe('MCP 写路径稳定错误码（IF-1）', () => {
  it('streamable-http 缺 url → WF_MCP_BAD_ARGS：文案点名缺失参数与两条出路，且不写盘', async () => {
    const { root, patch } = await useTempDshHome()
    const error = await capturedError(() =>
      upsertMcpServer({ id: 'mcp-http', serverName: 'http', transport: 'streamable-http' }),
    )
    expect(error?.code).toBe('WF_MCP_BAD_ARGS')
    // 可行动：说清哪个参数导致失败、如何修正；码本身也写进文案（错误码书写规范 §3.1）
    expect(String(error?.message)).toContain('WF_MCP_BAD_ARGS')
    expect(String(error?.message)).toMatch(/url/)
    expect(String(error?.message)).toMatch(/stdio/)
    // 入参校验失败发生在落盘之前：不留半成品配置
    await expect(readFile(patch, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(root, { recursive: true, force: true })
  })

  it('stdio 缺 command/commandLine → WF_MCP_BAD_ARGS：文案点名 commandLine 与可粘贴写法', async () => {
    const { root, patch } = await useTempDshHome()
    const error = await capturedError(() =>
      upsertMcpServer({ id: 'mcp-stdio', serverName: 'stdio', transport: 'stdio' }),
    )
    expect(error?.code).toBe('WF_MCP_BAD_ARGS')
    expect(String(error?.message)).toContain('WF_MCP_BAD_ARGS')
    expect(String(error?.message)).toMatch(/commandLine/)
    await expect(readFile(patch, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(root, { recursive: true, force: true })
  })

  it('toggle 不存在的服务器 → WF_MCP_NOT_FOUND（与「入参非法」是两个码）', async () => {
    const { root } = await useTempDshHome()
    // 先落一个真实服务器：确保「不存在」不是「托管区尚未创建」的特例
    await upsertMcpServer({ id: 'mcp-a', serverName: 'a', transport: 'stdio', commandLine: 'node a.js' })
    const error = await capturedError(() => toggleMcpServer('mcp-missing', true))
    expect(error?.code).toBe('WF_MCP_NOT_FOUND')
    // 可行动：回显被查找的 id，并给出修正方向
    expect(String(error?.message)).toContain('mcp-missing')
    expect(String(error?.message)).toMatch(/id/)
    await rm(root, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// 宽松 id 解析的回归锁（IF-2）：删除/停用必须能处理历史非规范 id
// ---------------------------------------------------------------------------
//
// 被保护的行为：normalizeMcpId 只补 `mcp-` 前缀、**不做字符校验**（严格校验只作用于
// 写入路径 requireValidMcpId）。历史 profile 里可能存在早于该校验落盘的任意 id；
// 若有人「顺手收紧」normalizeMcpId，这些遗留条目将永远无法删除/停用。

const LEGACY_ID = 'mcp-legacy.id:1'
const LEGACY_PATCH = [
  '# >>> dsh-visual-workflow',
  '- insert:',
  `    - id: '${LEGACY_ID}'`,
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  "        serverName: 'legacy'",
  "        transport: 'stdio'",
  "        command: 'node'",
  '        args:',
  "          - 'legacy.js'",
  '# <<< dsh-visual-workflow',
].join('\n')

/** 手工落盘一份含历史非规范 id 的托管区（写入路径永远不会产出这种 id）。 */
async function seedLegacyPatch(patch: string): Promise<void> {
  await mkdir(dirname(patch), { recursive: true })
  await writeFile(patch, LEGACY_PATCH, 'utf8')
}

describe('删除/停用的宽松 id 解析（IF-2）', () => {
  it('历史非规范 id：写入路径拒绝，但停用与删除仍可达', async () => {
    const { root, patch } = await useTempDshHome()
    await seedLegacyPatch(patch)
    // 两个入口口径差异是有意的：写入防 YAML 注入，清理不给历史数据设障
    await expect(
      upsertMcpServer({ id: LEGACY_ID, serverName: 'legacy', transport: 'stdio', commandLine: 'node legacy.js' }),
    ).rejects.toMatchObject({ code: 'WF_BAD_ARGS' })
    // 停用：按原 id 定位历史行，且行 id 不被改写
    const toggled = await toggleMcpServer(LEGACY_ID, true)
    expect(toggled.id).toBe(LEGACY_ID)
    expect(toggled.disabled).toBe(true)
    expect(parseMcpRows(await readFile(patch, 'utf8')).find((row) => row.id === LEGACY_ID)?.disabled).toBe(true)
    // 删除：历史条目真的从托管区移除
    expect(await removeMcpServer(LEGACY_ID)).toEqual({ deleted: true })
    expect(parseMcpRows(await readFile(patch, 'utf8')).some((row) => row.id === LEGACY_ID)).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('裸名称（无 mcp- 前缀）经 normalizeMcpId 补前缀定位既有行并可删除', async () => {
    const { root } = await useTempDshHome()
    await upsertMcpServer({ id: 'mcp-demo', serverName: 'demo', transport: 'stdio', commandLine: 'node demo.js' })
    expect(await removeMcpServer('demo')).toEqual({ deleted: true })
    await rm(root, { recursive: true, force: true })
  })
})
