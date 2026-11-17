// tests/integration/host-assembly.test.ts
//
// Host 装配集成测试（T-015，原 tests/host/host-assembly.test.ts）：用真实 @deepseek-ai/cordis
// Context（peer，测试期物化）启动插件 fiber——覆盖 host ↔ storage ↔ service ↔ agent 的多模块装配：
//   ① 启动无错且数据目录结构建立；② dataDir 缺失时 fiber 失败；③ fiber 卸载后事件监听与显式清理生效；
//   ④ agent/created 创建窗口内为子代理装配四类贡献（角色提示词/工具可见性/模型选择/软截停），
//      以及重发布/冷恢复时的重装语义。
// 断言依据：架构文档 §4.1/§9.6、SKILL §4.3 Effect 所有权、任务清单 T-015 DoD。

import { describe, expect, it, afterEach, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { VisualWorkflowHost, VisualWorkflowHostServiceName, type Config } from '../../src/host/index.js'
import { FlowStore } from '../../src/host/storage/flow-store.js'
import { ServiceManager } from '../../src/host/service/index.js'
import { VISUAL_WORKFLOW_PROMPT_SECTION } from '../../src/host/agent/prompt-setup.js'

/** 构造含临时 dataDir 的完整配置（其余键取 schema 默认）。 */
function makeConfig(dir: string): Config {
  return {
    dataDir: dir,
    servicePortBase: 7860,
    apiKey: null,
    maxConcurrentPerService: 50,
    wfAskAgentTimeoutMs: 120000,
    runIdleTimeoutMs: 1800000,
    runPollMs: 2000,
    reactIterationLimitDefault: 50,
    retryLimitDefault: 3,
    outputFullLimit: 102400,
    documentTextLimit: 20000,
    embeddingModelDir: null,
    embeddingEndpoint: null,
    difyMigratorCommand: 'dsh-dify-migrator',
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

describe('VisualWorkflowHost 装配', () => {
  it('真实 cordis 启动无错：service 提供、数据目录结构建立', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))

    // service 已提供且为宿主实例
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost
    expect(host).toBeInstanceOf(VisualWorkflowHost)
    expect(host.store).toBeInstanceOf(FlowStore)
    // 数据目录结构建立（§6 目录规划；顶层目录 + 嵌套子目录）
    for (const d of FlowStore.DIRS) {
      expect(existsSync(join(dir, d)), `目录 ${d} 应存在`).toBe(true)
    }
    for (const d of FlowStore.NESTED_DIRS) {
      expect(existsSync(join(dir, d)), `嵌套目录 ${d} 应存在`).toBe(true)
    }
    await root.fiber.dispose()
  })

  it('同一 fiber 内重复提供被 cordis 拒绝（service 唯一性）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    // 同一名称 service 二次注册会冲突（官方 Service 语义：同名冲突即报错）
    await expect(root.plugin(VisualWorkflowHost, makeConfig(dir))).rejects.toThrow()
    await root.fiber.dispose()
  })

  it('dataDir 缺失时 fiber 失败（不吞错，SKILL §4.2）', async () => {
    const root = new Context()
    await expect(root.plugin(VisualWorkflowHost, { ...makeConfig(''), dataDir: '' })).rejects.toThrow(/dataDir/)
    await root.fiber.dispose()
  })

  it('卸载后事件观察失效 + dispose 幂等', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    // 显式 dispose（模拟 fiber 卸载路径）
    host.dispose()
    expect(host.disposed).toBe(true)
    // 幂等：重复 dispose 不抛错
    expect(() => host.dispose()).not.toThrow()

    // 卸载后事件观察不再产生副作用：cordis 自动反注册 + 钩子内部清理态守卫双保险
    // （断言不抛错即通过；真实回写逻辑在 T-021 填充）
    expect(() => {
      root.emit('subagent/end', {})
      root.emit('agent/error', {})
    }).not.toThrow()
    await root.fiber.dispose()
  })

  it('skipReconcile 装配不执行 autoRecover（服务进程防自我 fork 回归）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const spy = vi.spyOn(ServiceManager.prototype, 'autoRecover').mockResolvedValue([])
    try {
      const root = new Context()
      // 服务进程装配语义（service-runner.ts 同款：手动 new + { skipReconcile: true }）
      const host = new VisualWorkflowHost(root, makeConfig(dir), { skipReconcile: true })
      await (host as unknown as { [Service.init](): Promise<void> })[Service.init]()
      // 服务进程只负责服务自身，不得扫描 status=running 的服务再次 start（自我 fork）
      expect(spy).not.toHaveBeenCalled()
      await root.fiber.dispose()
    } finally {
      spy.mockRestore()
    }
  })

  it('默认装配执行 autoRecover（主进程恢复上次运行中服务）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const spy = vi.spyOn(ServiceManager.prototype, 'autoRecover').mockResolvedValue([])
    try {
      const root = new Context()
      const host = new VisualWorkflowHost(root, makeConfig(dir))
      await (host as unknown as { [Service.init](): Promise<void> })[Service.init]()
      expect(spy).toHaveBeenCalled()
      await root.fiber.dispose()
    } finally {
      spy.mockRestore()
    }
  })

  it('agent/created：在 withPending 创建窗口内为视觉工作流子代理提前装配四类贡献', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    // 子代理 ctx fake：支持四类贡献所需的 on / systemPrompt.section / tools.get(restrict)
    const sections: Array<{ name: string; order: number }> = []
    const handlers = new Map<string, unknown[]>()
    const denies: Array<{ deny?: string[] }> = []
    const childCtx = {
      on(name: string, listener: unknown): () => void {
        handlers.set(name, [...(handlers.get(name) ?? []), listener])
        return () => {}
      },
      systemPrompt: {
        section(input: { name: string; order: number }): () => void {
          sections.push(input)
          return () => {}
        },
      },
      get(name: string): unknown {
        return name === 'tools'
          ? { get: () => ({}), restrict: (filter: { deny?: string[] }) => { denies.push(filter); return () => {} }, guard: (check: (exec: { name: string }) => string | undefined) => {
              denies.push({ deny: ["wf_run_node", "wf_finish"].filter((name) => check({ name }) !== undefined) })
              return () => {}
            } }
          : undefined
      },
    }

    // 模拟 startContinuable 内（withPending 作用域）出现的 agent/created
    await (host as unknown as { childPrompt: { withPending(s: unknown, o: () => Promise<void>): Promise<void> } })
      .childPrompt.withPending(
        { systemPrompt: '子代理角色', injectSystemPrompt: true, injectToolSections: true },
        async () => {
          await (host as unknown as { onAgentCreated(p: unknown): Promise<void> }).onAgentCreated({
            agent: { id: 'child-x', ctx: childCtx },
          })
        },
      )

    // ① 角色 Prompt 段已注册（per-agent sys.section）
    expect(sections.map((s) => s.name)).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    // ② 系统提示词组装过滤瀑布已挂
    expect(handlers.get('system-prompt/assemble')?.length ?? 0).toBeGreaterThan(0)
    // ③ 工具可见性双保险：wf_run_node / wf_finish deny 已在创建窗口内生效
    expect(denies.some((d) => Array.isArray(d.deny) && d.deny!.includes('wf_run_node'))).toBe(true)
    expect(denies.some((d) => Array.isArray(d.deny) && d.deny!.includes('wf_finish'))).toBe(true)

    await root.fiber.dispose()
  })

  it('agent/created 再次触发（重发布/恢复，不在 withPending 内）：用首建持久化状态重装，不回退官方提示词', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    const makeCtx = () => {
      const sections: Array<{ name: string; order: number }> = []
      const handlers = new Map<string, unknown[]>()
      const denies: Array<{ deny?: string[] }> = []
      const childCtx = {
        on(name: string, listener: unknown): () => void {
          handlers.set(name, [...(handlers.get(name) ?? []), listener])
          return () => {}
        },
        systemPrompt: { section(input: { name: string; order: number }): () => void { sections.push(input); return () => {} } },
        get(name: string): unknown {
          return name === 'tools'
            ? { get: () => ({}), restrict: (filter: { deny?: string[] }) => { denies.push(filter); return () => {} }, guard: (check: (exec: { name: string }) => string | undefined) => {
              denies.push({ deny: ["wf_run_node", "wf_finish"].filter((name) => check({ name }) !== undefined) })
              return () => {}
            } }
            : undefined
        },
      }
      return { childCtx, sections, handlers, denies }
    }

    const hostAs = host as unknown as {
      childPrompt: { withPending(s: unknown, o: () => Promise<void>): Promise<void>; hasPending(): boolean }
      onAgentCreated(p: unknown): void
    }

    // 首建：withPending 作用域内，install + 持久化状态
    const first = makeCtx()
    await hostAs.childPrompt.withPending(
      { systemPrompt: '子代理角色', injectSystemPrompt: true, injectToolSections: true },
      async () => { await hostAs.onAgentCreated({ agent: { id: 'child-x', ctx: first.childCtx } }) },
    )
    expect(first.sections.map((s) => s.name)).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)

    // 重发布/恢复：不再处于 withPending（子代理被卸载后重新发布 → session-start 再次触发）
    // 关键：必须用首建持久化状态重装四类贡献，否则回退官方提示词（二次重置 BUG 回归）
    const second = makeCtx()
    expect(hostAs.childPrompt.hasPending()).toBe(false)
    await hostAs.onAgentCreated({ agent: { id: 'child-x', ctx: second.childCtx } })

    expect(second.sections.map((s) => s.name)).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(second.handlers.get('system-prompt/assemble')?.length ?? 0).toBeGreaterThan(0)
    expect(second.denies.some((d) => Array.isArray(d.deny) && d.deny!.includes('wf_run_node'))).toBe(true)
    expect(second.denies.some((d) => Array.isArray(d.deny) && d.deny!.includes('wf_finish'))).toBe(true)

    await root.fiber.dispose()
  })

  it('agent/disposed 不清除持久化状态：创建→销毁→冷恢复重发布，仍能重装贡献（第二轮回退官方提示词回归）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost

    const makeCtx = () => {
      const sections: Array<{ name: string; order: number }> = []
      const handlers = new Map<string, unknown[]>()
      const denies: Array<{ deny?: string[] }> = []
      const childCtx = {
        on(name: string, listener: unknown): () => void {
          handlers.set(name, [...(handlers.get(name) ?? []), listener])
          return () => {}
        },
        systemPrompt: { section(input: { name: string; order: number }): () => void { sections.push(input); return () => {} } },
        get(name: string): unknown {
          return name === 'tools'
            ? { get: () => ({}), restrict: (filter: { deny?: string[] }) => { denies.push(filter); return () => {} }, guard: (check: (exec: { name: string }) => string | undefined) => {
              denies.push({ deny: ["wf_run_node", "wf_finish"].filter((name) => check({ name }) !== undefined) })
              return () => {}
            } }
            : undefined
        },
      }
      return { childCtx, sections, handlers, denies }
    }

    const hostAs = host as unknown as {
      childPrompt: { withPending(s: unknown, o: () => Promise<void>): Promise<void> }
      onAgentCreated(p: unknown): void
      onAgentDisposed(p: unknown): void
    }

    // ① 首建：withPending 作用域内 install + 持久化状态
    const first = makeCtx()
    await hostAs.childPrompt.withPending(
      { systemPrompt: '子代理角色', injectSystemPrompt: true, injectToolSections: true },
      async () => { await hostAs.onAgentCreated({ agent: { id: 'child-x', ctx: first.childCtx } }) },
    )
    expect(first.sections.map((s) => s.name)).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)

    // ② 子代理回合结束被官方 watchSettlement 销毁 → agent/disposed 触发。
    // 旧实现在此 delete 持久化状态，导致后续冷恢复无法重装（回归根因）。
    hostAs.onAgentDisposed({ agent: { id: 'child-x' } })

    // ③ 第二轮父代理派发 → coldResume 冷恢复（重新发布）→ 再次 agent/created
    //    （不在 withPending 内）。必须用首建持久化状态重装四类贡献，否则回退官方提示词。
    const second = makeCtx()
    await hostAs.onAgentCreated({ agent: { id: 'child-x', ctx: second.childCtx } })

    // 角色提示词段 / 组装瀑布 / 工具可见性 deny 均已重装（不因 dispose 丢失）
    expect(second.sections.map((s) => s.name)).toContain(VISUAL_WORKFLOW_PROMPT_SECTION)
    expect(second.handlers.get('system-prompt/assemble')?.length ?? 0).toBeGreaterThan(0)
    expect(second.denies.some((d) => Array.isArray(d.deny) && d.deny!.includes('wf_run_node'))).toBe(true)
    expect(second.denies.some((d) => Array.isArray(d.deny) && d.deny!.includes('wf_finish'))).toBe(true)

    await root.fiber.dispose()
  })
  it("test_one_policy_per_scope_republication_disposal_and_append_failure_cleanup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vw-host-"))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const root = new Context()
    await root.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = root.get(VisualWorkflowHostServiceName) as unknown as {
      childPrompt: { withPending(s: unknown, o: () => Promise<void>): Promise<void> }
      childToolFilter: { withPending(s: string[], o: () => Promise<void>): Promise<void> }
      onAgentCreated(p: unknown): Promise<void>
      onAgentDisposed(p: unknown): void
    }
    const guards: unknown[] = []
    const masks: unknown[] = []
    const childCtx = { get: () => ({ get: () => undefined,
      guard: (guard: unknown) => { guards.push(guard); return () => { guards.splice(guards.indexOf(guard), 1) } },
      restrict: (mask: unknown) => { masks.push(mask); return () => { masks.splice(masks.indexOf(mask), 1) } },
    }) }
    const agent = { id: "once", ctx: childCtx }
    const state = { systemPrompt: "角色", injectSystemPrompt: true, injectToolSections: true }
    const create = (value: unknown) => host.childPrompt.withPending(state, () => host.childToolFilter.withPending([], () => host.onAgentCreated({ agent: value })))
    await create(agent)
    const permissionGuards = () => guards.filter((guard) => (guard as (call: { name: string }) => string | undefined)({ name: "wf_finish" })?.startsWith("WF_NOT_ROOT"))
    expect(permissionGuards()).toHaveLength(1)
    expect(masks).toEqual([{ allow: [] }])
    await host.onAgentCreated({ agent })
    expect(permissionGuards()).toHaveLength(1)
    expect(masks).toHaveLength(1)
    host.onAgentDisposed({ agent })
    expect(guards).toHaveLength(0)
    expect(masks).toHaveLength(0)
    await expect(create({ ...agent, session: { append: () => { throw new Error("persistence failed") } } })).rejects.toThrow("persistence failed")
    expect(guards).toHaveLength(0)
    expect(masks).toHaveLength(0)
    await root.fiber.dispose()
  })

  it('跨 Host 重启从官方会话事件恢复空白名单；权限接口缺失阻止创建', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vw-host-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const events: unknown[] = []
    const session = { events, append: (type: string, data: unknown) => { events.push({ type, data }) } }
    const first = new Context()
    await first.plugin(VisualWorkflowHost, makeConfig(dir))
    const host = first.get(VisualWorkflowHostServiceName) as unknown as {
      childPrompt: { withPending(s: unknown, o: () => Promise<void>): Promise<void> }
      childToolFilter: { withPending(s: string[], o: () => Promise<void>): Promise<void> }
      onAgentCreated(p: unknown): Promise<void>
    }
    const masks: unknown[] = []
    const childCtx = { get: () => ({ get: () => ({}), guard: () => () => {}, restrict: (f: unknown) => { masks.push(f); return () => {} } }) }
    await host.childPrompt.withPending({ systemPrompt: '角色', injectSystemPrompt: true, injectToolSections: true }, () =>
      host.childToolFilter.withPending([], () => host.onAgentCreated({ agent: { id: 'durable-child', ctx: childCtx, session } })))
    expect(events).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ allow: [] }) }))
    await first.fiber.dispose()
    masks.length = 0
    const second = new Context()
    await second.plugin(VisualWorkflowHost, makeConfig(dir))
    const restored = second.get(VisualWorkflowHostServiceName) as unknown as { onAgentCreated(p: unknown): Promise<void> }
    await restored.onAgentCreated({ agent: { id: 'durable-child', ctx: childCtx, session } })
    expect(masks).toContainEqual({ allow: [] })
    await expect(restored.onAgentCreated({ agent: { id: 'durable-child', ctx: { get: () => undefined }, session } })).rejects.toMatchObject({ code: 'WF_CHILD_TOOL_POLICY_FAILED' })
    await second.fiber.dispose()
  })

})

it("test_host_rebuild_releases_retired_guards_and_observes_workflow_epochs_only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vw-host-recovery-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const root = new Context()
  const parent = { id: "parent-session", status: "idle" }
  const children = new Map<string, { id: string; ctx: ReturnType<typeof makeChildContext>["ctx"] }>()
  function makeChildContext() {
    const guards: Array<(call: { name: string }) => string | undefined> = []
    const masks: unknown[] = []
    const listeners: unknown[] = []
    const tools = {
      get: () => undefined,
      restrict: (mask: unknown) => { masks.push(mask); return () => { masks.splice(masks.indexOf(mask), 1) } },
      guard: (guard: (call: { name: string }) => string | undefined) => { guards.push(guard); return () => { guards.splice(guards.indexOf(guard), 1) } },
    }
    const ctx = {
      get: (name: string) => name === "tools" ? tools : undefined,
      on: (_name: string, listener: unknown) => { listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1) } },
      systemPrompt: { section: () => () => {} },
    }
    return { ctx, guards, masks, listeners }
  }
  class TestAgents extends Service {
    constructor(ctx: Context) { super(ctx, "agents") }
    get(id: string) { return id === parent.id ? parent : children.get(id) }
  }
  const scopes: ReturnType<typeof makeChildContext>[] = []
  class TestSubagents extends Service {
    constructor(ctx: Context) { super(ctx, "subagents") }
    list() { return ["spawn"] }
    async startContinuable() {
      const scope = makeChildContext()
      scopes.push(scope)
      const childId = `owned-${scopes.length}`
      const child = { id: childId, ctx: scope.ctx }
      children.set(childId, child)
      await root.serial("agent/created", { agent: child })
      root.emit("subagent/start", { id: childId, runId: `epoch-${scopes.length}` })
      return { childId }
    }
    async sendMessage() { children.delete("owned-1"); throw Object.assign(new Error("不能恢复持久子代理"), { name: "SubagentError", code: "NOT_RESUMABLE" }) }
    interrupt() {}
  }
  await root.plugin(TestAgents)
  await root.plugin(TestSubagents)
  await root.plugin(VisualWorkflowHost, makeConfig(dir))
  const host = root.get(VisualWorkflowHostServiceName) as VisualWorkflowHost
  const epoch = vi.spyOn(host.orchestrator, "handleSubagentStart")
  root.emit("subagent/start", { id: "unrelated", runId: "unrelated-epoch" })
  expect(epoch).not.toHaveBeenCalled()
  const input = {
    sessionId: parent.id, flowId: "flow", signal: new AbortController().signal,
    node: { id: "node", kind: "agent" as const, position: { x: 0, y: 0 }, data: { label: "角色", systemPrompt: "节点独立任务", provider: "", model: "", presetId: null, retryLimit: 1, inputSchema: "", outputSchema: "" } },
    blocks: [{ type: "text" as const, text: "完整任务" }],
  }
  const first = await host.runner.startNodeTask(input)
  expect(scopes[0].guards.some((guard) => guard({ name: "wf_finish" })?.startsWith("WF_NOT_ROOT"))).toBe(true)
  const second = await host.runner.startNodeTask(input)
  expect(second.replacedChildId).toBe(first.childId)
  expect(scopes[0].guards).toHaveLength(0)
  expect(scopes[0].masks).toHaveLength(0)
  expect(scopes[0].listeners).toHaveLength(0)
  expect(scopes[1].guards.some((guard) => guard({ name: "wf_finish" })?.startsWith("WF_NOT_ROOT"))).toBe(true)
  expect(epoch.mock.calls.map(([info]) => info)).toEqual([{ id: "owned-1", runId: "epoch-1" }, { id: "owned-2", runId: "epoch-2" }])
  // 配置替换时旧 Agent 尚在内存，中断是尽力而为；权限不能提前撤销。
  await host.runner.startNodeTask({ ...input, node: { ...input.node, data: { ...input.node.data, systemPrompt: "新的角色配置" } } })
  expect(scopes[1].guards.some((guard) => guard({ name: "wf_finish" })?.startsWith("WF_NOT_ROOT"))).toBe(true)
  const disposed = children.get("owned-2")!
  children.delete("owned-2")
  root.emit("agent/disposed", { agent: disposed })
  expect(scopes[1].guards).toHaveLength(0)
  expect(scopes[1].masks).toHaveLength(0)
  await root.fiber.dispose()
  expect(scopes[2].guards).toHaveLength(0)
})
