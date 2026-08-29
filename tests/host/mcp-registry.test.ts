// tests/host/mcp-registry.test.ts
// MCP 命令行解析：shell 感知启动解析（npx/.cmd/.ps1 展开）与 commandLine 回填往返。
// 纯函数单测，不依赖 harness；resolveSpawnCommandLine 通过 platform 参数固定分支。

import { describe, expect, it } from 'vitest'
import { resolveSpawnCommandLine, renderCommandLine } from '../../src/host/remote/mcp-registry.js'

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
