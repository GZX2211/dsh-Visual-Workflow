// D11C-02 回归门禁：构建产物契约门禁必须是**只读**的（不得改写受版本控制的 lib/）。
//
// 为什么独立成文件：本用例以子进程重新执行 build-artifacts.test.ts 本体；若并入同一文件
// 会自递归（子进程又一次执行本用例）。
//
// 断言对象的可观测后果：lib/ 是受版本控制的产物目录，且 tests/contract/cordis-patch.test.ts
// 会在同一 vitest pool 内动态 import lib/index.js。一旦门禁在测试进程内真实构建，
// scripts/build.mjs 第零步会整体 rmSync(lib/types) 并重写 lib/*.js：
//   ① 与并行的动态 import 争用同一目录树（本次治理全量并行运行时 cordis-patch 超时的真因）；
//   ② 与并发 `pnpm build` 互删互写；
//   ③ 污染工作区（lib/** 内容/mtime 被改写）；
//   ④ 让每次 `pnpm test` 额外付出一次 tsc×3 + tsdown 的 CPU 成本。
// 故「跑完该门禁后 lib/ 指纹不变」是这条契约的可观测判据。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录（package.json 所在目录）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// 被测门禁本体：子进程重新执行它，观察它对 lib/ 的副作用。
const GATE_FILE = 'tests/contract/build-artifacts.test.ts'

/** vitest CLI 入口（devDependency，必装）。 */
const vitestBin = resolve(root, 'node_modules/vitest/vitest.mjs')

/** 递归列出目录下所有文件（返回绝对路径）。 */
function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/**
 * lib/ 全量产物指纹：`相对路径 → 大小:mtimeMs:内容 sha256`。
 * mtime 是「构建是否真的写盘」的判据（重复构建内容可能逐字节相同，mtime 必然变化）。
 */
function fingerprintLib(): Map<string, string> {
  const snapshot = new Map<string, string>()
  for (const file of collectFiles(resolve(root, 'lib'))) {
    const stat = statSync(file)
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
    snapshot.set(relative(root, file).split(sep).join('/'), `${stat.size}:${stat.mtimeMs}:${digest}`)
  }
  return snapshot
}

/** 比较两份指纹，返回可读的差异清单（截断到 20 条，避免断言输出淹没日志）。 */
function diffFingerprint(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = []
  for (const [file, value] of before) {
    const now = after.get(file)
    if (now === undefined) changed.push(`被删除 ${file}`)
    else if (now !== value) changed.push(`被改写 ${file}`)
  }
  for (const file of after.keys()) if (!before.has(file)) changed.push(`新增 ${file}`)
  return changed.slice(0, 20)
}

/**
 * 子进程环境：剥离 vitest 注入的 worker 标记，避免嵌套运行时按「已在 worker 内」解释
 * 池化参数（嵌套的是独立进程，不是复用父进程的 worker 池）。
 */
function isolatedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase().startsWith('VITEST')) continue
    env[key] = value
  }
  return env
}

describe('D11C-02 构建产物门禁的只读性（不得改写受版本控制的 lib/）', () => {
  it('运行 build-artifacts 门禁后 lib/ 产物指纹完全不变', () => {
    expect(existsSync(vitestBin), `vitest CLI 缺失：${vitestBin}`).toBe(true)
    const before = fingerprintLib()
    // 子进程执行门禁本体：以 stdio inherit 直接 spawn（不捕获 pipe），沿用仓库约定。
    // --no-file-parallelism 使子进程内也无文件级并发，观察到的副作用只可能来自该门禁自身。
    execFileSync(
      process.execPath,
      [vitestBin, 'run', GATE_FILE, '--pool=threads', '--no-file-parallelism'],
      { cwd: root, stdio: 'inherit', env: isolatedEnv() },
    )
    // 前后指纹必须逐字节逐 mtime 一致：门禁只允许读产物，不允许写产物。
    expect(diffFingerprint(before, fingerprintLib())).toEqual([])
  }, 300_000)
})
