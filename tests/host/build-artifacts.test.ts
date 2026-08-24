// T-003 构建产物测试：beforeAll 真实构建一次（execFileSync + stdio inherit，规避 pipe EPERM），
// 随后断言 client/host 两半产物并存、client 产物含 __ModuleLoader__ 包装与 style[data-plugin]
// 注入、sourcemap 存在、exports["./client"].types 指向的 lib/types/client/index.d.ts 真实可命中。
//
// 运行环境：node（host 测试默认）。构建产物断言与 P01 的 package-contract.test.ts 互补：
// 前者校验 package.json 静态契约，本测试校验 P01/P02 构建链路产出的真实文件。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// 项目根目录（package.json 所在目录）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 读取产物文件内容（附加「文件缺失」上下文）。 */
function readArtifact(rel: string): string {
  const p = resolve(root, rel)
  expect(existsSync(p), `产物缺失：${rel}`).toBe(true)
  return readFileSync(p, 'utf8')
}

// 真实构建一次：以 inherit stdio 直接执行 build.mjs（node -- <file> 直接 spawn，
// 不捕获 pipe），规避 Windows 沙箱下 named pipe 被禁导致的 EPERM（见 SKILL §6）。
// 放在 beforeAll 中，使本测试不依赖外部「先跑过 build」的隐式前提。
// hook 超时放宽：全量并行时构建（host 双发射 + client 声明 + tsdown）可能超过
// vitest 默认 hook 超时（10s），构建是重操作而非测试逻辑问题。
beforeAll(() => {
  execFileSync(process.execPath, [resolve(root, 'scripts/build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
}, 120_000)

describe('T-003 构建链路（client bundle + host/client 并存）', () => {
  it('lib/client.js 存在且含 __ModuleLoader__.load 包装', () => {
    const code = readArtifact('lib/client.js')
    expect(code).toContain('window.__ModuleLoader__.load({')
  })

  it('lib/client.js 含 style[data-plugin]（CSS 注入机制）', () => {
    const code = readArtifact('lib/client.js')
    expect(code).toContain('style[data-plugin')
  })

  it('lib/index.js（host 产物）仍存在（client build 未清空 host 输出）', () => {
    expect(existsSync(resolve(root, 'lib/index.js'))).toBe(true)
  })

  it('lib/client.js.map（sourcemap）存在', () => {
    expect(existsSync(resolve(root, 'lib/client.js.map'))).toBe(true)
  })

  it('lib/types/client/index.d.ts 存在（exports["./client"].types 契约真实可命中）', () => {
    const dts = readArtifact('lib/types/client/index.d.ts')
    // 转发文件应把公开 API 从 entry 重新导出（P11 起 rootDir=src，入口在 client/ 子目录），
    // 保证 ./client 的类型入口非空壳。
    expect(dts).toContain("export * from './client/entry'")
  })
})
