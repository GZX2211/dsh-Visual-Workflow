// tests/host/service-manager.test.ts
//
// 模式二服务管理器单测（T-031，fake 子进程）：
//   start 全链路（patch 渲染/spawn 参数/文档 running+port）、校验错误、
//   崩溃标记 crashed、stop（SIGTERM）、autoRecover（仅重启 running + 端口重分配）、
//   resolveDshCommand（PATH 解析/缺失明确错误）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import {
  ServiceManager,
  resolveDshCommand,
  SERVICE_ERR,
} from '../../src/host/service/manager.js'
import type { ServiceState } from '../../src/host/shared/types.js'
import type { RoleNode, StageNode, WorkflowDocument, Line } from '../../src/host/shared/graph-model.js'
import { stageLabel } from '../../src/host/graph/model.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function makeStore(): Promise<FlowStore> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-manager-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  return store
}

function stage(id: string, kind: 'start' | 'end'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode2') } }
}

function parent(id: string): RoleNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: { label: '父代理', systemPrompt: '服务角色', provider: 'deepseek', model: 'deepseek-chat', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null, proxySourceId: null },
  }
}

function role(id: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: { label: '子任务', systemPrompt: '任务', provider: 'deepseek', model: 'deepseek-chat', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null, proxySourceId: null },
  }
}

function flow(id: string, nodes: WorkflowDocument['nodes']): WorkflowDocument {
  return {
    id,
    sessionId: 'session-1',
    mode: 'mode2',
    name: '服务',
    description: '',
    nodes,
    lines: [],
    revision: 1,
  }
}

function makeService(id: string, flow: WorkflowDocument, status: ServiceState['status'] = 'stopped'): ServiceState {
  return {
    id,
    sessionId: flow.sessionId,
    name: flow.name,
    description: flow.description,
    revision: flow.revision ?? 1,
    nodes: flow.nodes,
    lines: flow.lines,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    status,
  }
}

/** 合法模式二流（父代理唯一 + 输入/输出齐备）。 */
function validFlow(id: string): WorkflowDocument {
  return flow(id, [stage('n-in', 'start'), parent('n-parent'), role('n-a1'), stage('n-out', 'end')])
}

/** fake 子进程（EventEmitter；记录 kill 信号，可模拟 exit/error）。 */
class FakeChild extends EventEmitter {
  pid = 4242
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed: Array<string | number> = []
  kill(signal: string | number): boolean {
    this.killed.push(signal)
    return true
  }
  emitExit(code: number | null, signal: string | null = null): void {
    this.emit('exit', code, signal)
  }
}

interface SpawnRecord {
  command: string
  args: string[]
  options: { cwd: string; shell: boolean; stdio: readonly ('ignore' | 'pipe')[] }
}

interface ManagerHarness {
  store: FlowStore
  manager: ServiceManager
  spawns: SpawnRecord[]
  children: FakeChild[]
  ports: number[]
}

function makeManager(store: FlowStore, dataDir: string, options: { ports?: number[] } = {}): ManagerHarness {
  const spawns: SpawnRecord[] = []
  const children: FakeChild[] = []
  const ports = options.ports ?? [17860]
  const manager = new ServiceManager({
    store,
    dataDir,
    config: { servicePortBase: 17860, apiKey: null, maxConcurrentPerService: 50 },
    dshCommand: 'C:\\dsh\\dsh.cmd',
    findPort: async () => ports.length > 0 ? ports.shift()! : 17860,
    spawn: ((command: string, args: string[], spawnOptions: { cwd: string; shell: boolean; stdio: readonly ('ignore' | 'pipe')[] }) => {
      spawns.push({ command, args, options: spawnOptions })
      const child = new FakeChild()
      children.push(child)
      return child as never
    }) as never,
  })
  return { store, manager, spawns, children, ports }
}

describe('ServiceManager.start', () => {
  it('全链路：渲染 patch + fork 参数 + 文档 running/port + 返回状态', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    const result = await h.manager.start('svc-1')

    expect(result).toMatchObject({ serviceId: 'svc-1', status: 'running', port: 17860, pid: 4242 })
    // spawn 参数形态：serviceId/port 已渲染进 patch config；fork 只传占位 task
    // 位置参数（headless 应用 commander 不识别 app 级 flag，见 manager.ts 注释）
    expect(h.spawns[0].args).toEqual([
      '--profile', 'headless',
      '--patch', join(store.root, 'services', 'svc-1.serve.patch.yml'),
      '__visual_workflow_service__',
    ])
    expect(h.spawns[0].options.cwd).toBe(store.root)
    // win32 下 dsh.cmd 需要 cmd 外壳执行；Unix 直接 exec
    expect(h.spawns[0].options.shell).toBe(process.platform === 'win32')
    expect(h.spawns[0].options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    // patch 产物已渲染
    const patch = await readFile(join(store.root, 'services', 'svc-1.serve.patch.yml'), 'utf8')
    expect(patch).toContain('id: headless-runner')
    expect(patch).toContain('serviceId: "svc-1"')
    // 文档运行字段
    const saved = await store.getServiceById('svc-1')
    expect(saved?.status).toBe('running')
    expect(saved?.port).toBe(17860)
    expect(saved?.lastStartedAt).toBeTruthy()
  })

  it('服务不存在 → WF_SERVICE_NOT_FOUND', async () => {
    const store = await makeStore()
    const h = makeManager(store, store.root)
    await expect(h.manager.start('nope')).rejects.toMatchObject({ code: SERVICE_ERR.NOT_FOUND })
  })

  it('非法 serviceId → WF_SERVICE_BAD_ID（命令注入消毒）', async () => {
    const store = await makeStore()
    const h = makeManager(store, store.root)
    await expect(h.manager.start('svc; rm -rf /')).rejects.toMatchObject({ code: SERVICE_ERR.BAD_ID })
    expect(h.spawns.length).toBe(0)
  })

  it('已运行服务再次启动 → WF_SERVICE_RUNNING', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    await h.manager.start('svc-1')
    await expect(h.manager.start('svc-1')).rejects.toMatchObject({ code: SERVICE_ERR.RUNNING })
  })

  it('图校验失败（模式二缺父代理）→ WF_FLOW_INVALID', async () => {
    const store = await makeStore()
    const bad = flow('svc-bad', [stage('n-in', 'start'), role('n-a1'), stage('n-out', 'end')])
    await store.saveService(makeService('svc-bad', bad), 'session-1')
    const h = makeManager(store, store.root)
    await expect(h.manager.start('svc-bad')).rejects.toMatchObject({ code: SERVICE_ERR.FLOW_INVALID })
    expect(h.spawns.length).toBe(0)
  })

  it('Bug 11：并发 start 同一服务仅 spawn 一次（竞态护栏）', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const spawns: SpawnRecord[] = []
    const children: FakeChild[] = []
    let portCalls = 0
    let release!: () => void
    const gate = new Promise<void>((rs) => { release = rs })
    // findPort 处设置门闩：两个并发 start 都通过首次 has 检查后停在等待点
    const manager = new ServiceManager({
      store,
      dataDir: store.root,
      config: { servicePortBase: 17860, apiKey: null, maxConcurrentPerService: 50 },
      dshCommand: 'C:\\dsh\\dsh.cmd',
      findPort: async () => { portCalls += 1; await gate; return 17860 },
      spawn: ((command: string, args: string[], spawnOptions: { cwd: string; shell: boolean; stdio: readonly ('ignore' | 'pipe')[] }) => {
        spawns.push({ command, args, options: spawnOptions })
        const child = new FakeChild()
        children.push(child)
        return child as never
      }) as never,
    })
    const p1 = manager.start('svc-1')
    // 立即挂上 p2 的拒绝断言，避免 release 前其 rejected 变成 unhandled rejection
    const p2 = manager.start('svc-1')
    const p2Assertion = expect(p2).rejects.toMatchObject({ code: SERVICE_ERR.RUNNING })
    // 互斥登记在 start 开头同步完成：第二个并发调用在 findPort（首个异步点）前即被拦截
    await new Promise((rs) => setTimeout(rs, 20))
    expect(portCalls).toBe(1)
    release()
    // 修复前：两个都 spawn → 双进程/双端口（孤儿 + 泄漏）；修复后：仅首个成功
    await expect(p1).resolves.toMatchObject({ serviceId: 'svc-1', status: 'running', port: 17860 })
    await p2Assertion
    expect(spawns).toHaveLength(1)
    expect(children).toHaveLength(1)
  })

  it('Bug 12：persistRuntime 失败 → 回滚已启动进程并抛 START_FAILED', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    // 破坏 saveService：persistRuntime 的写入首次调用抛错（模拟磁盘故障）
    const original = store.saveService.bind(store)
    const saveSpy = vi.fn(original)
    ;(store as unknown as { saveService: unknown }).saveService = saveSpy.mockRejectedValueOnce(new Error('disk full')) as never

    await expect(h.manager.start('svc-1')).rejects.toMatchObject({ code: SERVICE_ERR.START_FAILED })
    // 回滚：子进程被杀 + 内存登记注销（文档状态保持 stopped，无幽灵运行）
    expect(h.children[0]?.killed).toContain('SIGTERM')
    const saved = await store.getServiceById('svc-1')
    expect(saved?.status).toBe('stopped')
    // 登记已清理：再次启动不应报 RUNNING，且这次持久化成功
    await expect(h.manager.start('svc-1')).resolves.toMatchObject({ status: 'running' })
    expect(h.spawns).toHaveLength(2)
  })

  it('apiKey 配置时文档写入 apiKeyHash', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    h.manager = new ServiceManager({
      store,
      dataDir: store.root,
      config: { servicePortBase: 17860, apiKey: 'secret-1', maxConcurrentPerService: 50 },
      dshCommand: 'C:\\dsh\\dsh.cmd',
      findPort: async () => 17860,
      spawn: (() => { const child = new FakeChild(); h.children.push(child); return child as never }) as never,
    })
    await h.manager.start('svc-1')
    const saved = await store.getServiceById('svc-1')
    expect(saved?.apiKeyHash).toBeTruthy()
    expect(saved?.apiKeyHash).not.toContain('secret-1')
  })
})

describe('ServiceManager 生命周期', () => {
  it('子进程意外退出 → 文档 crashed + 内存条目清理（可重启）', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    await h.manager.start('svc-1')
    h.children[0].emitExit(1)
    await vi.waitFor(async () => {
      const saved = await store.getServiceById('svc-1')
      expect(saved?.status).toBe('crashed')
      expect(saved?.lastStoppedAt).toBeTruthy()
    }, { timeout: 5000 })
    // crashed 后可重启
    await expect(h.manager.start('svc-1')).resolves.toMatchObject({ status: 'running' })
  })

  it('stop：SIGTERM + 文档 stopped；exit 后不覆盖 crashed', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    await h.manager.start('svc-1')
    const result = await h.manager.stop('svc-1')
    expect(result).toMatchObject({ serviceId: 'svc-1', status: 'stopped' })
    expect(h.children[0].killed).toContain('SIGTERM')
    const saved = await store.getServiceById('svc-1')
    expect(saved?.status).toBe('stopped')
    // 主动停止后的 exit 不把状态覆盖为 crashed
    h.children[0].emitExit(0)
    await vi.waitFor(async () => {
      expect((await store.getServiceById('svc-1'))?.status).toBe('stopped')
    })
  })

  it('stop 未运行的服务：仅置文档 stopped（幂等）', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1'), 'crashed'), 'session-1')
    const h = makeManager(store, store.root)
    await expect(h.manager.stop('svc-1')).resolves.toMatchObject({ status: 'stopped' })
    expect(h.children.length).toBe(0)
    expect((await store.getServiceById('svc-1'))?.status).toBe('stopped')
  })

  it('status：内存存活时带 pid，否则读文档', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    const h = makeManager(store, store.root)
    await h.manager.start('svc-1')
    expect(await h.manager.status('svc-1')).toMatchObject({ serviceId: 'svc-1', status: 'running', port: 17860, pid: 4242 })
    h.children[0].emitExit(1)
    await vi.waitFor(async () => {
      expect((await h.manager.status('svc-1')).status).toBe('crashed')
    })
    await expect(h.manager.status('nope')).rejects.toMatchObject({ code: SERVICE_ERR.NOT_FOUND })
  })

  it('dispose：全部子进程 SIGTERM', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-1', validFlow('svc-1')), 'session-1')
    await store.saveService(makeService('svc-2', validFlow('svc-2')), 'session-1')
    const h = makeManager(store, store.root, { ports: [17860, 17861] })
    await h.manager.start('svc-1')
    await h.manager.start('svc-2')
    h.manager.dispose()
    expect(h.children.map((c) => c.killed)).toEqual([['SIGTERM'], ['SIGTERM']])
  })
})

describe('autoRecover', () => {
  it('仅重启 status=running 的服务；端口冲突重新分配', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-run', validFlow('svc-run'), 'running'), 'session-1')
    await store.saveService(makeService('svc-stop', validFlow('svc-stop'), 'stopped'), 'session-1')
    const h = makeManager(store, store.root, { ports: [17870] })
    const restarted = await h.manager.autoRecover()
    expect(restarted).toEqual(['svc-run'])
    expect(h.spawns.length).toBe(1)
    // serviceId/port 经 patch config 传入（fork 参数只含占位 task）
    const recoveredPatch = await readFile(join(store.root, 'services', 'svc-run.serve.patch.yml'), 'utf8')
    expect(recoveredPatch).toContain('svc-run')
    // 新端口落盘
    expect((await store.getServiceById('svc-run'))?.port).toBe(17870)
    // stopped 服务不被拉起
    expect((await store.getServiceById('svc-stop'))?.status).toBe('stopped')
  })

  it('恢复失败不阻塞其他服务（记录告警）', async () => {
    const store = await makeStore()
    await store.saveService(makeService('svc-missing-flow', validFlow('svc-missing-flow'), 'running'), 'session-1')
    await store.saveService(makeService('svc-ok', validFlow('svc-ok'), 'running'), 'session-1')
    // 让第一个服务图校验失败：删除其 flow 文档（getServiceAsFlow 仍可读 service 文档）
    await store.deleteService('session-1', 'svc-missing-flow')
    const h = makeManager(store, store.root, { ports: [17880] })
    const restarted = await h.manager.autoRecover()
    expect(restarted).toEqual(['svc-ok'])
  })
})

describe('resolveDshCommand', () => {
  it('PATH 中命中 dsh 可执行（win32 优先 dsh.cmd）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-dsh-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'dsh.cmd'), '@echo off\n')
    await writeFile(join(dir, 'dsh'), '#!/bin/sh\n')
    const found = resolveDshCommand(`${dir}${process.platform === 'win32' ? ';' : ':'}C:\\other`)
    expect(found).toBe(join(dir, 'dsh.cmd'))
  })

  it('PATH 无 dsh → 明确错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-dsh-empty-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    expect(() => resolveDshCommand(`${dir}${process.platform === 'win32' ? ';' : ':'}D:\\empty`)).toThrow('未找到 dsh 命令')
  })

  it('空 PATH 抛 WF_DSH_NOT_FOUND 错误码', () => {
    try {
      resolveDshCommand('')
      expect.unreachable()
    } catch (error) {
      expect((error as { code?: string }).code).toBe(SERVICE_ERR.DSH_NOT_FOUND)
    }
  })
})
