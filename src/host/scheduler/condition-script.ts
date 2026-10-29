// src/host/scheduler/condition-script.ts
//
// 第三层条件触发的执行器（IO 边界）：保存时校验脚本路径（stat），运行期以 Node
// 子进程执行脚本并按 stdout 最后一行判定是否放行。
//
// 为什么不用 shell / execFile：脚本是 .mjs/.cjs/.js，必须由 Node 解释器启动；
// Electron 宿主下 process.execPath 是 electron 二进制，需 ELECTRON_RUN_AS_NODE=1
// 才能按 Node 模式运行（见方案 §5.4）。路径与参数以数组传递，不经过 shell 分词。
//
// 安全边界（方案 §9）：脚本以宿主进程权限运行、继承环境变量、无沙箱；本模块只负责
// 执行与结果判定，不额外提权，也不做进程树清理（已知限制）。

import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { CONDITION_SCRIPT_EXTENSION_MESSAGE, hasSupportedScriptExtension, parseConditionOutput } from './condition-config.js'

/** 条件脚本执行输入（引擎提供，脚本可经环境变量读取）。 */
export interface ConditionScriptInput {
  scriptPath: string
  taskId: string
  taskName: string
  templateId: string
  /** 理论触发时刻（UTC 毫秒）。 */
  triggerAt: number
  timezone: string
  ownerSessionId: string
}

/** 条件脚本执行结果；pass=false 时 detail 为可展示的原因。 */
export interface ConditionScriptOutcome {
  pass: boolean
  detail: string
}

/** 执行器缝（引擎只依赖此接口）。 */
export interface ConditionScriptRunner {
  run(input: ConditionScriptInput): Promise<ConditionScriptOutcome>
}

export interface ConditionScriptRunnerOptions {
  /** 测试注入；缺省使用 node:child_process.spawn。 */
  spawnImpl?: typeof spawn
  /** 测试注入；缺省 process.execPath。 */
  execPath?: string
  /** 超时毫秒（缺省 10_000）。 */
  timeoutMs?: number
  /** 测试注入；缺省 process.env。 */
  env?: NodeJS.ProcessEnv
  /** 测试注入；缺省 Boolean(process.versions.electron)。 */
  isElectron?: boolean
}

/** 默认超时（固定上限，控制单任务对 tick 扫描的阻塞）。 */
const DEFAULT_TIMEOUT_MS = 10_000
/** 超时 kill 后等待 close 的兜底时长（避免执行器永久挂起）。 */
const KILL_FALLBACK_MS = 1_000
/** stdout 只保留最后一行的判定内容，避免长输出撑爆内存。 */
const LAST_LINE_LIMIT = 1_024
/** stderr 只保留尾部摘要（用于 detail）。 */
const STDERR_TAIL_LIMIT = 2_048

/** 保存时校验：路径必须是存在且可访问的普通文件（入参已是 Host 校验过的绝对路径）。 */
export async function validateConditionScriptPath(raw: string): Promise<void> {
  const path = String(raw ?? '')
  let info
  try {
    info = await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR' || code === 'EPERM') {
      // 缺失路径上「扩展名不受支持」比「不存在」更具体：用户换一个脚本即可修复，
      // 无需先放置文件；保存端点的读盘校验因此在纯校验之前执行。
      if (!hasSupportedScriptExtension(path)) throw new Error(CONDITION_SCRIPT_EXTENSION_MESSAGE)
      throw new Error(`条件脚本文件不存在或不可访问：${path}（请填写存在的绝对路径文件）`)
    }
    throw error
  }
  if (!info.isFile()) throw new Error(`条件脚本路径不是文件：${path}`)
}

/** 创建条件脚本执行器（依赖可注入，测试用 fake spawn 控制事件顺序）。 */
export function createConditionScriptRunner(options: ConditionScriptRunnerOptions = {}): ConditionScriptRunner {
  const spawnImpl = options.spawnImpl ?? spawn
  const execPath = options.execPath ?? process.execPath
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const baseEnv = options.env ?? process.env
  const isElectron = options.isElectron ?? Boolean(process.versions.electron)

  return {
    run(input) {
      return runOnce({ spawnImpl, execPath, timeoutMs, baseEnv, isElectron }, input)
    },
  }
}

interface RunnerContext {
  spawnImpl: typeof spawn
  execPath: string
  timeoutMs: number
  baseEnv: NodeJS.ProcessEnv
  isElectron: boolean
}

function runOnce(context: RunnerContext, input: ConditionScriptInput): Promise<ConditionScriptOutcome> {
  return new Promise<ConditionScriptOutcome>((resolve) => {
    let settled = false
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let killFallback: ReturnType<typeof setTimeout> | null = null
    let stdoutBuffer = ''
    let stderrTail = ''
    const timeoutOutcome: ConditionScriptOutcome = { pass: false, detail: '条件脚本执行超时（10 秒）' }

    const settle = (outcome: ConditionScriptOutcome): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (killFallback) clearTimeout(killFallback)
      resolve(outcome)
    }

    let child: ChildProcess
    const env: NodeJS.ProcessEnv = {
      ...context.baseEnv,
      // Electron 打包的宿主进程：让 electron 二进制以 Node 模式运行脚本。
      ...(context.isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      WF_TASK_ID: input.taskId,
      WF_TASK_NAME: input.taskName,
      WF_TEMPLATE_ID: input.templateId,
      WF_TRIGGER_AT: new Date(input.triggerAt).toISOString(),
      WF_TIMEZONE: input.timezone,
      WF_SESSION_ID: input.ownerSessionId,
    }
    // 非 Electron 环境不得透传继承来的同名变量：该开关只对 electron 二进制有意义，
    // 保留它会让「纯 Node 宿主」的启动参数与契约 T1-7 不一致。
    if (!context.isElectron) delete env.ELECTRON_RUN_AS_NODE
    try {
      child = context.spawnImpl(context.execPath, [input.scriptPath], {
        cwd: dirname(input.scriptPath),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      settle({ pass: false, detail: `无法启动条件脚本：${messageOf(error)}` })
      return
    }

    // error 监听必须常驻：resolve 之后迟到的 error（如 kill 后的 EPERM）若无人监听，
    // 会以未捕获异常打崩宿主进程（定时任务运行在宿主进程内）。
    child.on('error', (error) => {
      settle(timedOut ? timeoutOutcome : { pass: false, detail: `无法启动条件脚本：${messageOf(error)}` })
    })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuffer = `${stdoutBuffer}${String(chunk)}`.slice(-LAST_LINE_LIMIT * 4)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-STDERR_TAIL_LIMIT)
    })

    child.on('close', (code) => {
      if (settled) return
      // close 可能先于最后一批 data 事件到达：先把管道里剩余缓冲读尽再判定，
      // 否则「最后一行 true」会因读取时序被判成空输出（假失败）。
      stdoutBuffer = `${stdoutBuffer}${drainBuffered(child.stdout)}`.slice(-LAST_LINE_LIMIT * 4)
      stderrTail = `${stderrTail}${drainBuffered(child.stderr)}`.slice(-STDERR_TAIL_LIMIT)
      if (timedOut) {
        settle(timeoutOutcome)
        return
      }
      if (code === 0) {
        settle(parseConditionOutput(lastLineOf(stdoutBuffer)))
        return
      }
      settle({ pass: false, detail: `条件脚本退出码 ${String(code)}：${stderrTail.trim()}` })
    })

    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // 子进程可能已退出；kill 失败不影响「超时视为不通过」的判定。
      }
      // kill 后 close 可能迟迟不到（平台差异）：兜底计时器保证执行器一定结算。
      killFallback = setTimeout(() => settle(timeoutOutcome), KILL_FALLBACK_MS)
    }, context.timeoutMs)
  })
}

/** stdout 最后一行非空文本（忽略行尾空行，长度受限）。 */
function lastLineOf(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  return (lines[lines.length - 1] ?? '').slice(0, LAST_LINE_LIMIT)
}

/** 读出可读流里尚未派发的缓冲数据（close 与 data 事件的到达顺序没有保证）。 */
function drainBuffered(stream: Readable | null): string {
  if (!stream) return ''
  let text = ''
  let chunk: unknown
  while ((chunk = stream.read()) !== null) text += String(chunk)
  return text
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
