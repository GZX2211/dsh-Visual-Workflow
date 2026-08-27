// src/host/service/manager.ts
//
// 模式二服务管理器：服务进程生命周期（fork/停止/崩溃标记/自动恢复）。
//
// 启动链：消毒 serviceId → 服务存在/未运行/图校验 → 端口池分配 → 渲染
// serve.patch.yml（原子写）→ fork `dsh --profile headless --patch <产物>
// --visual-workflow-serve <serviceId> --port <n>`（环境继承 + cwd=数据根；
// PATH 无 dsh 时报明确错误）→ 持久化 running + port。
//
// 生命周期：非主动停止的 exit → crashed（可重启）；stop → SIGTERM → 5s →
// SIGKILL；主进程重启后 autoRecover 扫描 status=running 的服务重启
// （端口冲突由端口池重新分配兜底）。

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, delimiter, isAbsolute } from 'node:path'
import { atomicReplaceFile } from '../storage/atomic.js'
import type { FlowStore } from '../storage/flow-store.js'
import { validateFlow } from '../graph/validate.js'
import { renderServePatch } from './serve-patch.js'
import { findFreePort } from './port-pool.js'

/**
 * Windows 进程树终止：shell:true 启动的服务进程链表为 cmd(dsh.cmd) → node(dsh)，
 * 单发 SIGTERM/SIGKILL 只杀 cmd 壳，node 孤儿继续占用端口。故强杀路径统一
 * taskkill /T（树形）；POSIX 直接 SIGKILL 即可。
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // 进程已退出：忽略
  }
}

/** 服务管理器错误码（api.ts 路由层映射 HTTP 状态）。 */
export const SERVICE_ERR = {
  NOT_FOUND: 'WF_SERVICE_NOT_FOUND',
  RUNNING: 'WF_SERVICE_RUNNING',
  BAD_ID: 'WF_SERVICE_BAD_ID',
  FLOW_INVALID: 'WF_FLOW_INVALID',
  DSH_NOT_FOUND: 'WF_DSH_NOT_FOUND',
  START_FAILED: 'WF_SERVICE_START_FAILED',
} as const

/** 服务管理器错误（携带稳定 code 供路由层分支）。 */
export class ServiceManagerError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ServiceManagerError'
    this.code = code
  }
}

/** serviceId 合法字符（命令参数消毒：仅字母数字点下划线短横线）。 */
const SERVICE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/

/** SIGTERM 后的强制终止宽限期（架构：SIGTERM → 5s → SIGKILL）。 */
export const STOP_GRACE_MS = 5_000

/** 日志缝。 */
export interface ManagerLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

export interface ServiceManagerDeps {
  /** 数据层（服务文档读写）。 */
  store: FlowStore
  /** 数据根目录（patch 产物落盘 + 子进程 cwd）。 */
  dataDir: string
  /** 端口池基址 / 鉴权密钥 / 并发上限。 */
  config: { servicePortBase: number; apiKey: string | null; maxConcurrentPerService: number }
  /** 日志缝（缺省静默）。 */
  logger?: ManagerLogger
  /** 时钟注入（时间戳字段）。 */
  now?: () => number
  /** dsh 可执行路径（缺省 PATH 解析；测试注入）。 */
  dshCommand?: string
  /** 端口分配（缺省 findFreePort；测试注入）。 */
  findPort?: (base: number) => Promise<number>
  /** 子进程工厂（测试注入 fake）。 */
  spawn?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; stdio: readonly ('ignore' | 'pipe')[] }) => ChildProcess
}

interface ManagedChild {
  child: ChildProcess
  port: number
  /** 主动停止标记（exit 时不再标记 crashed）。 */
  stopping: boolean
  forceKill: ReturnType<typeof setTimeout> | null
}

/**
 * 模式二服务管理器（每 Host 一个实例；内存仅持有存活子进程）。
 */
export class ServiceManager {
  private readonly children = new Map<string, ManagedChild>()
  /** in-flight 启动集合（Bug 11 并发启动互斥：start 开头同步登记，finally 注销）。 */
  private readonly starting = new Set<string>()

  constructor(private readonly deps: ServiceManagerDeps) {}

  private log(): ManagerLogger {
    return this.deps.logger ?? {}
  }

  private isoNow(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString()
  }

  /** 启动服务（幂等护栏：已运行/正在启动 → 冲突错误）。 */
  async start(serviceId: string): Promise<{ serviceId: string; status: string; port: number; pid?: number }> {
    const id = sanitizeServiceId(serviceId)
    if (this.children.has(id)) {
      throw new ServiceManagerError(SERVICE_ERR.RUNNING, `服务 ${id} 正在运行中`)
    }
    // 并发启动互斥（Bug 11）：children.has 与 children.set 之间跨越多个 await
    // （读服务/读流程/校验/找端口/写 patch）。启动开头同步登记 in-flight，
    // 使并发 start 在第一个异步点之前即被拦截——不再双写 patch 文件（Windows
    // rename EPERM）、不再双 spawn 子进程、不再双分配端口；finally 中注销。
    if (this.starting.has(id)) {
      throw new ServiceManagerError(SERVICE_ERR.RUNNING, `服务 ${id} 正在启动中`)
    }
    this.starting.add(id)
    try {
      return await this.startInner(id)
    } finally {
      this.starting.delete(id)
    }
  }

  /** start 实际执行体（starting 互斥集合保护下运行）。 */
  private async startInner(id: string): Promise<{ serviceId: string; status: string; port: number; pid?: number }> {
    const service = await this.deps.store.getServiceById(id)
    if (!service) {
      throw new ServiceManagerError(SERVICE_ERR.NOT_FOUND, `服务不存在：${id}`)
    }
    const flow = await this.deps.store.getServiceAsFlow(id)
    if (!flow) {
      throw new ServiceManagerError(SERVICE_ERR.NOT_FOUND, `服务不存在：${id}`)
    }
    const validation = validateFlow(flow)
    if (!validation.ok) {
      throw new ServiceManagerError(
        SERVICE_ERR.FLOW_INVALID,
        `服务工作流校验未通过：${validation.issues[0]?.message ?? '未知问题'}`,
      )
    }

    const port = await (this.deps.findPort ?? ((base: number) => findFreePort(base)))(this.deps.config.servicePortBase)
    const patchPath = this.patchPath(id)
    const pluginEntryUrl = new URL('../service-runner.js', import.meta.url).href
    await atomicReplaceFile(
      patchPath,
      Buffer.from(renderServePatch({
        serviceId: id,
        dataDir: this.deps.dataDir,
        port,
        apiKey: this.deps.config.apiKey,
        maxConcurrent: this.deps.config.maxConcurrentPerService,
        pluginEntryUrl,
      }), 'utf8'),
    )

    // 并发启动护栏：上方首次 has 检查与 children.set 之间跨越多个 await
    // （读服务/读流程/校验/找端口/写 patch），两个并发 start 会同时通过检查
    // 并各自 spawn 子进程（孤儿进程 + 端口泄漏）。此处二次检查与 children.set
    // 之间无 await（同一同步块），先登记的一方成功后另一方在此被拦截。
    if (this.children.has(id)) {
      throw new ServiceManagerError(SERVICE_ERR.RUNNING, `服务 ${id} 正在运行中`)
    }
    const dshCommand = this.deps.dshCommand ?? resolveDshCommand()
    const child = this.spawnChild(dshCommand, id, port, patchPath)
    const managed: ManagedChild = { child, port, stopping: false, forceKill: null }
    this.children.set(id, managed)

    // stdout/stderr 持续消费（不消费会阻塞子进程管道）；转发到进程 stdout（终端可见）
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        this.log().info?.(`[service:${id}] ${line}`)
        try {
          process.stdout.write(`[service:${id}] ${line}\n`)
        } catch {
          // stdout 不可用时忽略
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        this.log().warn?.(`[service:${id}] ${line}`)
        try {
          process.stdout.write(`[service:${id}] ${line}\n`)
        } catch {
          // stdout 不可用时忽略
        }
      }
    })

    child.once('error', (error) => {
      this.log().warn?.(`[service:${id}] 进程错误：${error.message}`)
      this.forget(id)
      void this.persistRuntime(id, { status: 'crashed', lastStoppedAt: this.isoNow() }).catch(() => {})
    })
    child.once('exit', (code, signal) => {
      const entry = this.children.get(id)
      if (!entry) return
      if (entry.forceKill) clearTimeout(entry.forceKill)
      this.forget(id)
      if (entry.stopping) return // 主动停止：文档状态已置 stopped
      this.log().warn?.(`[service:${id}] 进程意外退出（code=${code ?? ''} signal=${signal ?? ''}），标记 crashed`)
      void this.persistRuntime(id, { status: 'crashed', lastStoppedAt: this.isoNow() }).catch(() => {})
    })

    try {
      await this.persistRuntime(id, {
        status: 'running',
        port,
        lastStartedAt: this.isoNow(),
        ...(this.deps.config.apiKey ? { apiKeyHash: hashApiKey(this.deps.config.apiKey) } : { apiKeyHash: undefined }),
      })
    } catch (error) {
      // 状态持久化失败 ≠ 启动成功：子进程已 fork，若不回滚会出现「用户看到
      // 启动失败但进程存活」的半启动状态（进程占端口、文档还是 stopped）。
      // 回滚 = 终止进程树 + 注销内存登记 + 抛明确错误。
      this.log().warn?.(`[service:${id}] 状态持久化失败（${error instanceof Error ? error.message : String(error)}），回滚已启动的进程`)
      managed.stopping = true
      try {
        child.kill('SIGTERM')
      } catch {
        // 尽力而为（子进程可能已退出）
      }
      killProcessTree(Number(child.pid ?? 0))
      this.forget(id)
      throw new ServiceManagerError(SERVICE_ERR.START_FAILED, `服务状态持久化失败：${error instanceof Error ? error.message : String(error)}`)
    }
    // 终端启动反馈（dsh web 控制台）：服务已启动 + 端口 + REST API 访问方式。
    // 用户要求：此信息必须出现在 dsh web 启动终端（不是 DSH 主界面/工作台）。
    // 关键事实：dsh web 的 cordis logger 不会输出到进程 stdout（实测只有
    // "dsh web: http://…" 两行 shell 提示）——故横幅直接写进程 stdout（console）。
    const serviceName = service.name || id
    const auth = this.deps.config.apiKey
      ? `Authorization: Bearer <您的 API Key>（已启用鉴权：${this.deps.config.apiKey.slice(0, 4)}****）`
      : '无鉴权（默认本机/内网直连；可在配置 apiKey 后启用）'
    const lines = [
      '',
      '═══════════════════════════════════════════════════════',
      `  💡 后台服务已启动：${serviceName}（${id}）`,
      `     进程 PID：${child.pid ?? '未知'}    服务状态：running`,
      `     监听地址：http://127.0.0.1:${port}`,
      '',
      '  REST API（OpenAI 兼容）：',
      `     POST  http://127.0.0.1:${port}/v1/chat/completions`,
      `     GET   http://127.0.0.1:${port}/v1/models`,
      `     鉴权：${auth}`,
      '     请求体：{ "messages": [{"role":"user","content":"你好"}], "stream": true, "user_id": "用户标识" }',
      '     userId 必填（body `user_id` 或 Header `X-User-Id`），多用户会话完全隔离',
      '',
      '  curl 示例：',
      `     curl -N -X POST http://127.0.0.1:${port}/v1/chat/completions \\`,
      `       -H "Content-Type: application/json" ${this.deps.config.apiKey ? '-H "Authorization: Bearer <API Key>" ' : ''}\\`,
      `       -d '{"messages":[{"role":"user","content":"你好"}],"stream":true,"user_id":"demo-user"}'`,
      '',
      '  停止服务：在工作台点击「停止服务」，或重启 dsh 后由插件自动恢复（若上次为运行中）。',
      '═══════════════════════════════════════════════════════',
      '',
    ]
    for (const line of lines) {
      // 双写：logger 归档 + 进程 stdout 直出（dsh web 终端可见）
      this.log().info?.(line)
      try {
        process.stdout.write(`${line}\n`)
      } catch {
        // stdout 不可用时忽略（logger 已归档）
      }
    }
    this.log().info?.(`[service:${id}] 服务已启动（端口 ${port}），常规输出见下方服务日志`)
    return { serviceId: id, status: 'running', port, pid: child.pid }
  }

  /** 停止服务（SIGTERM → 5s → SIGKILL；立即持久化 stopped）。 */
  async stop(serviceId: string): Promise<{ serviceId: string; status: string }> {
    const id = sanitizeServiceId(serviceId)
    const managed = this.children.get(id)
    if (managed) {
      managed.stopping = true
      const child = managed.child
      this.log().info?.(`[service:${id}] 停止服务（SIGTERM）`)
      try {
        child.kill('SIGTERM')
      } catch (error) {
        this.log().warn?.(`[service:${id}] SIGTERM 失败：${error instanceof Error ? error.message : String(error)}`)
      }
      // stdin 关闭（EOF）→ 服务进程优雅退出（Windows shell 信号透传不可靠）
      try {
        child.stdin?.end()
      } catch {
        // stdin 已关
      }
      managed.forceKill = setTimeout(() => {
        killProcessTree(Number(child.pid ?? 0))
      }, STOP_GRACE_MS)
    }
    await this.persistRuntime(id, { status: 'stopped', lastStoppedAt: this.isoNow() })
    return { serviceId: id, status: 'stopped' }
  }

  /** 服务状态（内存存活进程的 pid + 文档状态）。 */
  async status(serviceId: string): Promise<{ serviceId: string; status: string; port?: number; pid?: number }> {
    const id = sanitizeServiceId(serviceId)
    const managed = this.children.get(id)
    const service = await this.deps.store.getServiceById(id)
    if (!service) throw new ServiceManagerError(SERVICE_ERR.NOT_FOUND, `服务不存在：${id}`)
    return {
      serviceId: id,
      status: managed ? service.status : service.status,
      port: service.port,
      ...(managed ? { pid: managed.child.pid } : {}),
    }
  }

  /** 自动恢复：扫描文档中 status=running 的服务并重启（端口冲突重分配）。 */
  async autoRecover(): Promise<string[]> {
    const running = await this.deps.store.listServicesAll()
    const restarted: string[] = []
    for (const service of running) {
      if (service.status !== 'running' || this.children.has(service.id)) continue
      try {
        await this.start(service.id)
        restarted.push(service.id)
        this.log().info?.(`[service] 自动恢复：${service.id}`)
      } catch (error) {
        this.log().warn?.(`[service] 自动恢复失败 ${service.id}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return restarted
  }

  /** 停止全部服务（主进程卸载时尽力而为）。 */
  dispose(): void {
    for (const [id, managed] of [...this.children]) {
      managed.stopping = true
      if (managed.forceKill) clearTimeout(managed.forceKill)
      try {
        managed.child.kill('SIGTERM')
      } catch {
        // 尽力而为
      }
      // 树形兜底（Windows 下 cmd 壳被杀后 node 服务进程可能残留）
      killProcessTree(Number(managed.child.pid ?? 0))
    }
    this.children.clear()
  }

  /** 清理内存条目（幂等；exit/error 路径共用）。 */
  private forget(serviceId: string): void {
    const entry = this.children.get(serviceId)
    if (!entry) return
    if (entry.forceKill) clearTimeout(entry.forceKill)
    this.children.delete(serviceId)
  }

  /** patch 产物路径（<dataDir>/services/<serviceId>.serve.patch.yml）。 */
  private patchPath(serviceId: string): string {
    return join(this.deps.dataDir, 'services', `${serviceId}.serve.patch.yml`)
  }

  private spawnChild(dshCommand: string, serviceId: string, port: number, patchPath: string): ChildProcess {
    const factory = this.deps.spawn ?? spawn
    // 参数约定（为什么这样传，官方 CLI 事实）：
    //   - headless 应用的 commander 只自持 task 位置参数；app 级未知 flag
    //     （--visual-workflow-serve/--port）会被 commander 拒绝 → 进程崩溃
    //     （此前根因：服务启动即 crashed）。
    //   - serviceId/port 已在 renderServePatch 渲染进 patch config（config 域），
    //     服务进程经 ctx.cmdlineArgs→parseServiceArgs 优先解析 flag、缺省回退
    //     config——故 fork 只传一个占位 task 位置参数满足 headless-startup 的
    //     非空校验；headless-runner 已被 serve patch disabled，不会执行该任务。
    return factory(dshCommand, [
      '--profile', 'headless',
      '--patch', patchPath,
      '__visual_workflow_service__',
    ], {
      cwd: this.deps.dataDir,
      env: process.env,
      shell: process.platform === 'win32',
      // stdin 用 pipe：服务进程监听 EOF（父进程退出/主动关闭 → 优雅退出，
      // 规避 Windows shell 层信号无法转发到 node 的进程树断裂问题）
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  /** 更新服务文档的运行时字段（读最新磁盘值后合并写）。 */
  private async persistRuntime(serviceId: string, patch: Partial<{ status: string; port: number; lastStartedAt: string; lastStoppedAt: string; apiKeyHash: string | undefined }>): Promise<void> {
    const current = await this.deps.store.getServiceById(serviceId)
    if (!current) return
    const next: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    await this.deps.store.saveService(next as never, current.sessionId)
  }
}

/** serviceId 消毒（拒绝非法字符，防命令注入）。 */
function sanitizeServiceId(serviceId: string): string {
  const id = String(serviceId ?? '').trim()
  if (!SERVICE_ID_PATTERN.test(id)) {
    throw new ServiceManagerError(SERVICE_ERR.BAD_ID, 'serviceId 只能包含字母数字、点、下划线与短横线')
  }
  return id
}

/** apiKey 哈希（文档仅存哈希用于展示"已启用鉴权"）。 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
}

/**
 * 从 PATH 解析 dsh 可执行文件（Windows 优先 dsh.cmd；Unix 直接 dsh）。
 * 找不到时抛明确错误（WF_DSH_NOT_FOUND）。
 */
export function resolveDshCommand(envPath: string = process.env.PATH ?? ''): string {
  const names = process.platform === 'win32' ? ['dsh.cmd', 'dsh.ps1', 'dsh.exe', 'dsh'] : ['dsh']
  for (const raw of envPath.split(delimiter)) {
    const dir = raw.trim().replace(/^"|"$/g, '')
    if (!dir || !isAbsolute(dir)) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // 单项不可访问跳过
      }
    }
  }
  throw new ServiceManagerError(
    SERVICE_ERR.DSH_NOT_FOUND,
    '未找到 dsh 命令（PATH 中无 dsh）；请安装 dsh 或将其所在目录加入 PATH 后重试',
  )
}
