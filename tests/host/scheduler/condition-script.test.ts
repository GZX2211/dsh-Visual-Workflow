// tests/host/scheduler/condition-script.test.ts
//
// 条件脚本执行器（scheduler/condition-script.ts）：保存时路径校验 + 运行期 spawn/超时/输出判定。
// 子进程一律注入 fake spawn（事件顺序可控、不依赖真实 node 与平台 kill 行为），
// 只有 validateConditionScriptPath 走真实临时目录（它本身就是 IO 契约）。
//
// 动态导入原因同 condition-config.test.ts：模块尚未创建时逐条给出「实现缺失」的失败。

import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const MODULE_URL = new URL('../../../src/host/scheduler/condition-script.js', import.meta.url).href

interface ConditionScriptInput {
  scriptPath: string
  taskId: string
  taskName: string
  templateId: string
  triggerAt: number
  timezone: string
  ownerSessionId: string
}

interface ConditionScriptOutcome {
  pass: boolean
  detail: string
}

interface ConditionScriptRunner {
  run(input: ConditionScriptInput): Promise<ConditionScriptOutcome>
}

interface SpawnCall {
  file: string
  args: readonly string[]
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: unknown; windowsHide?: boolean }
}

interface ConditionScriptModule {
  validateConditionScriptPath(raw: string): Promise<void>
  createConditionScriptRunner(options?: {
    spawnImpl?: typeof spawn
    execPath?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    isElectron?: boolean
  }): ConditionScriptRunner
}

async function loadModule(): Promise<ConditionScriptModule> {
  return await import(/* @vite-ignore */ MODULE_URL) as unknown as ConditionScriptModule
}

/** 可控假子进程：stdout/stderr 用 Readable（同时支持 on('data') 与异步迭代），close 由用例显式触发。 */
class FakeChild extends EventEmitter {
  readonly stdout = new Readable({ read() {} })
  readonly stderr = new Readable({ read() {} })
  killed = false
  killSignal: string | undefined

  kill(signal?: string): boolean {
    this.killed = true
    this.killSignal = signal
    return true
  }

  writeStdout(text: string): void {
    this.stdout.push(Buffer.from(text))
  }

  writeStderr(text: string): void {
    this.stderr.push(Buffer.from(text))
  }

  /** 子进程正常/异常退出。 */
  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal)
  }
}

/** 假 spawn：记录调用参数，返回可编排的 FakeChild。 */
function makeFakeSpawn(child = new FakeChild()): { spawnImpl: typeof spawn; calls: SpawnCall[]; child: FakeChild } {
  const calls: SpawnCall[] = []
  const spawnImpl = ((file: string, args: readonly string[], options: SpawnCall['options']) => {
    calls.push({ file, args, options })
    return child
  }) as unknown as typeof spawn
  return { spawnImpl, calls, child }
}

const INPUT: ConditionScriptInput = {
  scriptPath: join(tmpdir(), 'wf-scripts', 'check-issue.mjs'),
  taskId: 'task-1',
  taskName: '每日巡检',
  templateId: 'tpl-1',
  triggerAt: Date.UTC(2026, 8, 1, 2, 0, 0),
  timezone: 'Asia/Shanghai',
  ownerSessionId: 's-1',
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

describe('条件脚本路径校验（保存时读盘）', () => {
  it('存在的普通文件 → resolve', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-cond-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const script = join(dir, 'check.mjs')
    await writeFile(script, 'console.log(true)\n')
    const mod = await loadModule()

    await expect(mod.validateConditionScriptPath(script)).resolves.toBeUndefined()
  })

  it('文件不存在 → 拒绝并提示「不存在或不可访问」', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-cond-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const mod = await loadModule()

    await expect(mod.validateConditionScriptPath(join(dir, 'missing.mjs'))).rejects.toThrow('不存在或不可访问')
  })

  it('路径是目录 → 拒绝并提示「不是文件」', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-cond-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const nested = join(dir, 'scripts')
    await mkdir(nested)
    const mod = await loadModule()

    await expect(mod.validateConditionScriptPath(nested)).rejects.toThrow('不是文件')
  })
})

describe('条件脚本执行：输出判定', () => {
  it('最后一行 true → 通过，detail 为空', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub' })

    const pending = runner.run(INPUT)
    child.writeStdout('some log\n')
    child.writeStdout('true\n')
    child.finish(0)

    await expect(pending).resolves.toEqual({ pass: true, detail: '' })
  })

  it('最后一行 false → 不通过，detail 说明返回 false', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub' })

    const pending = runner.run(INPUT)
    child.writeStdout('false\n')
    child.finish(0)

    const outcome = await pending
    expect(outcome.pass).toBe(false)
    expect(outcome.detail.toLowerCase()).toContain('false')
  })

  it('退出码非 0 → 不通过，detail 含退出码与 stderr 摘要', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub' })

    const pending = runner.run(INPUT)
    child.writeStderr('gh: not logged in\n')
    child.finish(3)

    const outcome = await pending
    expect(outcome.pass).toBe(false)
    expect(outcome.detail).toContain('3')
    expect(outcome.detail).toContain('not logged in')
  })

  it('输出为空或不是布尔 → 不通过，detail 指明不是 true/false', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub' })

    const pending = runner.run(INPUT)
    child.writeStdout('done\n')
    child.finish(0)

    const outcome = await pending
    expect(outcome.pass).toBe(false)
    expect(outcome.detail).toContain('true/false')
  })
})

describe('条件脚本执行：启动参数', () => {
  it('用当前解释器直接启动脚本，cwd 为脚本目录，注入 WF_* 环境变量', async () => {
    const { spawnImpl, calls, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub', isElectron: false })

    const pending = runner.run(INPUT)
    child.writeStdout('true\n')
    child.finish(0)
    await pending

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.file).toBe('node-stub')
    expect(call.args).toEqual([INPUT.scriptPath])
    expect(call.options.cwd).toBe(dirname(INPUT.scriptPath))
    expect(call.options.windowsHide).toBe(true)
    expect(call.options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(call.options.env).toMatchObject({
      WF_TASK_ID: 'task-1',
      WF_TASK_NAME: '每日巡检',
      WF_TEMPLATE_ID: 'tpl-1',
      WF_TIMEZONE: 'Asia/Shanghai',
      WF_SESSION_ID: 's-1',
    })
    expect(call.options.env?.WF_TRIGGER_AT).toBe(new Date(INPUT.triggerAt).toISOString())
    // 纯 Node 环境不得带 Electron 专用开关
    expect(call.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('Electron 宿主以 Node 模式启动脚本（ELECTRON_RUN_AS_NODE=1）', async () => {
    const { spawnImpl, calls, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'electron-stub', isElectron: true })

    const pending = runner.run(INPUT)
    child.writeStdout('true\n')
    child.finish(0)
    await pending

    expect(calls[0]?.options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

describe('条件脚本执行：失败路径', () => {
  it('超时 → 不通过，detail 含「超时」，并强制终止子进程', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub', timeoutMs: 10 })

    const outcome = await runner.run(INPUT)

    expect(outcome.pass).toBe(false)
    expect(outcome.detail).toContain('超时')
    expect(child.killed).toBe(true)
  })

  it('spawn 报错 → 不通过，detail 含「无法启动」', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub' })

    const pending = runner.run(INPUT)
    child.emit('error', new Error('spawn ENOENT'))
    child.finish(-2)

    const outcome = await pending
    expect(outcome.pass).toBe(false)
    expect(outcome.detail).toContain('无法启动')
  })

  it('resolve 之后迟到的 error/close 不再改变结果，也不抛未捕获异常', async () => {
    const { spawnImpl, child } = makeFakeSpawn()
    const mod = await loadModule()
    const runner = mod.createConditionScriptRunner({ spawnImpl, execPath: 'node-stub', timeoutMs: 10 })

    const outcome = await runner.run(INPUT)
    expect(outcome.pass).toBe(false)

    // 实现必须常驻 error 监听：无监听时 EventEmitter 会同步抛出未捕获异常
    expect(() => child.emit('error', new Error('late EPERM'))).not.toThrow()
    expect(() => child.finish(null, 'SIGKILL')).not.toThrow()
  })
})

describe('宿主装配：条件执行器接入引擎依赖缝', () => {
  it('visual-workflow-host 装配 createConditionScriptRunner（漏装配会让条件层恒不通过）', () => {
    const source = readFileSync('src/host/visual-workflow-host.ts', 'utf8')
    expect(source).toContain('createConditionScriptRunner')
  })
})
