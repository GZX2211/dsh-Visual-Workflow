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

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, delimiter, isAbsolute } from 'node:path'
import { atomicReplaceFile } from '../storage/atomic.js'
import type { FlowStore } from '../storage/flow-store.js'
import { validateFlow } from '../graph/validate.js'
import { renderServePatch } from './serve-patch.js'
import { findFreePort } from './port-pool.js'

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

  constructor(private readonly deps: ServiceManagerDeps) {}

  private log(): ManagerLogger {
    return this.deps.logger ?? {}
  }

  private isoNow(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString()
  }

  /** 启动服务（幂等护栏：已运行 → 冲突错误）。 */
  async start(serviceId: string): Promise<{ serviceId: string; status: string; port: number; pid?: number }> {
    const id = sanitizeServiceId(serviceId)
    if (this.children.has(id)) {
      throw new ServiceManagerError(SERVICE_ERR.RUNNING, `服务 ${id} 正在运行中`)
    }
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

    const dshCommand = this.deps.dshCommand ?? resolveDshCommand()
    const child = this.spawnChild(dshCommand, id, port, patchPath)
    const managed: ManagedChild = { child, port, stopping: false, forceKill: null }
    this.children.set(id, managed)

    // stdout/stderr 持续消费（不消费会阻塞子进程管道）
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.log().info?.(`[service:${id}] ${line}`)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.log().warn?.(`[service:${id}] ${line}`)
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

    await this.persistRuntime(id, {
      status: 'running',
      port,
      lastStartedAt: this.isoNow(),
      ...(this.deps.config.apiKey ? { apiKeyHash: hashApiKey(this.deps.config.apiKey) } : { apiKeyHash: undefined }),
    })
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
      managed.forceKill = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 进程已退出
        }
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
    return factory(dshCommand, [
      '--profile', 'headless',
      '--patch', patchPath,
      '--visual-workflow-serve', serviceId,
      '--port', String(port),
    ], {
      cwd: this.deps.dataDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
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
