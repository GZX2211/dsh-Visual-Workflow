// tests/host/storage/flow-store.test.ts
//
// FlowStore 数据层测试（T-012）：全 CRUD、会话隔离（workflow/service 按 sessionId）、
// revision 冲突保护、原子性与锁一致性（并发保存无撕裂/无垃圾文件）、userId 映射持久化、
// 模板时间戳记账与单资源读语义。断言依据：架构文档 §4.1 + 需求文档 §4.2.2/§4.7/§6
// + src/host/storage/AGENTS.md。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore, FlowRevisionConflictError } from '../../../src/host/storage/flow-store.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import type { ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate, ToolCombo, RunSnapshot } from '../../../src/host/shared/types.js'
import { newRoleNode, newStageNode, newLine } from '../../../src/host/graph/index.js'

let dir: string
let store: FlowStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vw-store-'))
  store = new FlowStore(dir)
  await store.init()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeFlow(id: string, sessionId: string, name = '流程'): WorkflowDocument {
  const start = newStageNode('start', 'mode1')
  const end = newStageNode('end', 'mode1')
  const agent = newRoleNode('agent', 'a')
  return {
    id,
    sessionId,
    mode: 'mode1',
    name,
    description: '',
    nodes: [start, end, agent],
    lines: [newLine(start.id, agent.id, 'flow-out', 'flow-in'), newLine(agent.id, end.id, 'flow-out', 'flow-in')],
    revision: 0,
  }
}

function makeService(id: string, sessionId: string): ServiceState {
  return {
    id,
    sessionId,
    name: '服务',
    description: '',
    revision: 0,
    nodes: [],
    lines: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'stopped',
  }
}

function makeRoleTemplate(id: string): RoleTemplate {
  return { id, kind: 'agent', name: '角色', systemPrompt: 'p', provider: 'deepseek', model: 'chat', presetId: null, retryLimit: 3, reactLimit: null }
}

describe('FlowStore.init 目录结构', () => {
  it('创建全部规划目录（顶层 DIRS + 嵌套 NESTED_DIRS）', async () => {
    const names = await readdir(dir)
    for (const d of FlowStore.DIRS) {
      expect(names, `缺少顶层目录 ${d}`).toContain(d)
    }
    // 嵌套子目录（受管文件副本目录）单独成表，避免顶层目录常量混入路径片段
    for (const d of FlowStore.NESTED_DIRS) {
      const parts = d.split('/')
      expect(names, `缺少顶层目录 ${parts[0]}`).toContain(parts[0])
      const nested = await readdir(join(dir, parts[0]))
      expect(nested, `缺少嵌套子目录 ${d}`).toContain(parts[1])
    }
    // 幂等：重复 init 不抛错
    await store.init()
  })
})

describe('工作流 CRUD 与会话隔离', () => {
  it('保存→读取→列出→删除全链路', async () => {
    const flow = makeFlow('f1', 's1')
    const saved = await store.saveWorkflow(flow, 's1')
    expect(saved.revision).toBe(1)
    expect(saved.sessionId).toBe('s1')
    expect(saved.updatedAt).toBeTruthy()
    expect(await store.getWorkflow('s1', 'f1')).not.toBeNull()
    expect((await store.getWorkflow('s1', 'f1'))!.revision).toBe(1)
    expect((await store.listWorkflows('s1')).map((f) => f.id)).toEqual(['f1'])
    expect(await store.deleteWorkflow('s1', 'f1')).toBe(true)
    expect(await store.getWorkflow('s1', 'f1')).toBeNull()
    expect(await store.deleteWorkflow('s1', 'f1')).toBe(false)
  })

  it('会话隔离：他会话不可见/不可读/不可删', async () => {
    await store.saveWorkflow(makeFlow('f1', 's1'), 's1')
    await store.saveWorkflow(makeFlow('f2', 's2'), 's2')
    expect((await store.listWorkflows('s1')).map((f) => f.id)).toEqual(['f1'])
    expect((await store.listWorkflows('s2')).map((f) => f.id)).toEqual(['f2'])
    expect(await store.getWorkflow('s2', 'f1')).toBeNull()
    expect(await store.deleteWorkflow('s2', 'f1')).toBe(false)
    // s1 的 f1 仍在
    expect(await store.getWorkflow('s1', 'f1')).not.toBeNull()
  })

  it('工作台全局化：listWorkflows 无 sessionId 返回全部会话实例（按 updatedAt 倒序）', async () => {
    await store.saveWorkflow(makeFlow('f1', 's1'), 's1')
    await store.saveWorkflow({ ...makeFlow('f2', 's2'), updatedAt: '2026-09-02T00:00:00.000Z' }, 's2')
    const all = await store.listWorkflows()
    expect(all.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    expect(all.map((f) => f.sessionId).sort()).toEqual(['s1', 's2'])
    // 首个 = updatedAt 最新（f2 显式更晚）
    expect(all[0]?.id).toBe('f2')
  })

  it('revision 自动递增', async () => {
    const f = makeFlow('f1', 's1')
    const v1 = await store.saveWorkflow(f, 's1')
    const v2 = await store.saveWorkflow({ ...v1, name: '改名' }, 's1')
    expect(v1.revision).toBe(1)
    expect(v2.revision).toBe(2)
  })

  it('陈旧快照冲突保护：expectedRevision 不匹配抛错；force 可覆盖', async () => {
    const f = makeFlow('f1', 's1')
    const v1 = await store.saveWorkflow(f, 's1')
    // 另一会话保存 → revision 2
    await store.saveWorkflow({ ...v1, name: 'B' }, 's1')
    // 基于旧快照（revision 1）保存 → 冲突
    await expect(store.saveWorkflow({ ...v1, name: 'A' }, 's1', { expectedRevision: 1 })).rejects.toThrow(FlowRevisionConflictError)
    // force 保存成功 → revision 3
    const forced = await store.saveWorkflow({ ...v1, name: 'A' }, 's1', { force: true })
    expect(forced.revision).toBe(3)
  })
})

describe('服务 CRUD 与会话隔离', () => {
  it('保存→列出→读取→删除；sessions 映射文件不混入列表', async () => {
    const svc = makeService('svc1', 's1')
    await store.saveService(svc, 's1')
    await store.mergeUserIdMap('svc1', { u1: 'sess-1' })
    const list = await store.listServices('s1')
    expect(list.map((s) => s.id)).toEqual(['svc1'])
    expect(list[0].status).toBe('stopped')
    expect(await store.getService('s1', 'svc1')).not.toBeNull()
    expect(await store.deleteService('s1', 'svc1')).toBe(true)
    expect(await store.getService('s1', 'svc1')).toBeNull()
    // 级联删除 sessions 映射文件
    const files = await readdir(join(dir, 'services'))
    expect(files).toEqual([])
  })

  it('会话隔离：他会话不可见服务', async () => {
    await store.saveService(makeService('svc1', 's1'), 's1')
    expect(await store.listServices('s2')).toEqual([])
    expect(await store.getService('s2', 'svc1')).toBeNull()
    expect(await store.deleteService('s2', 'svc1')).toBe(false)
  })

  it('工作台全局化：listServices 无 sessionId 返回全部会话服务实例', async () => {
    await store.saveService(makeService('svc1', 's1'), 's1')
    await store.saveService(makeService('svc2', 's2'), 's2')
    const all = await store.listServices()
    expect(all.map((s) => s.id).sort()).toEqual(['svc1', 'svc2'])
    expect(all.map((s) => s.sessionId).sort()).toEqual(['s1', 's2'])
  })
})

// ---------------------------------------------------------------------------
// 服务文档 ↔ 模式二工作流视图（getServiceAsFlow / saveServiceAsFlow）
// ---------------------------------------------------------------------------

describe('服务视图读写（模式二编排入口）', () => {
  function serviceView(id: string, sessionId: string, nodes: WorkflowDocument['nodes'] = []): WorkflowDocument {
    return { id, sessionId, mode: 'mode2', name: '服务', description: '', nodes, lines: [] }
  }

  it('saveServiceAsFlow 只覆盖图结构与元参数，保留服务运行字段', async () => {
    await store.saveService({ ...makeService('svc-view', 's1'), status: 'running', port: 7861, apiKeyHash: 'hash' }, 's1')
    const start = newStageNode('start', 'mode2')
    const saved = await store.saveServiceAsFlow(serviceView('svc-view', 's1', [start]), 's1', { force: true })
    expect(saved.id).toBe('svc-view')
    expect(saved.mode).toBe('mode2')
    expect(saved.nodes.map((n) => n.kind)).toEqual(['start'])
    const onDisk = await store.getServiceById('svc-view')
    expect(onDisk?.status).toBe('running')
    expect(onDisk?.port).toBe(7861)
    expect(onDisk?.apiKeyHash).toBe('hash')
  })

  it('saveServiceAsFlow 转发实例元参数到工作流视图（P0-3 数据链路）', async () => {
    await store.saveService(makeService('svc-meta', 's1'), 's1')
    const saved = await store.saveServiceAsFlow({ ...serviceView('svc-meta', 's1'), meta: { nodeMax: 4 } }, 's1', { force: true })
    expect(saved.meta).toEqual({ nodeMax: 4 })
    expect((await store.getServiceById('svc-meta'))?.meta).toEqual({ nodeMax: 4 })
  })

  it('saveServiceAsFlow 校验存在性与会话归属（错误消息保持稳定）', async () => {
    await expect(store.saveServiceAsFlow(serviceView('svc-ghost', 's1'), 's1')).rejects.toThrow('服务不存在：svc-ghost')
    await store.saveService(makeService('svc-own', 's1'), 's1')
    await expect(store.saveServiceAsFlow(serviceView('svc-own', 's2'), 's2')).rejects.toThrow('服务不属于该会话：svc-own')
  })

  it('getServiceAsFlow 对不存在服务返回 null', async () => {
    expect(await store.getServiceAsFlow('nope')).toBeNull()
  })
})

describe('列表容错：损坏 JSON 不阻塞整个列表（Bug 21）', () => {
  it('listWorkflows 跳过损坏文件，正常文件仍返回', async () => {
    await store.saveWorkflow(makeFlow('good', 's1'), 's1')
    await writeFile(join(dir, 'workflows', 'corrupt.json'), '{ broken json', 'utf8')
    const list = await store.listWorkflows('s1')
    expect(list.map((f) => f.id)).toEqual(['good'])
  })

  it('listServices/listServicesAll/listTemplates/listRuns 同样跳过损坏文件', async () => {
    await store.saveService(makeService('svc1', 's1'), 's1')
    await store.saveTemplate('role', makeRoleTemplate('r1'))
    const run: RunSnapshot = {
      id: 'run-1', flowId: 'f1', flowName: '流程', sessionId: 's1', mode: 'mode1', status: 'completed',
      startedAt: '2026-08-24T00:00:00.000Z', endedAt: null, summary: '', nodes: [],
    }
    await store.saveRun(run)
    await writeFile(join(dir, 'workflows', 'bad.json'), '{', 'utf8')
    await writeFile(join(dir, 'services', 'bad.json'), '{', 'utf8')
    await writeFile(join(dir, 'roles', 'bad.json'), '{', 'utf8')
    await writeFile(join(dir, 'data', 'bad.json'), '{', 'utf8')
    await writeFile(join(dir, 'runs', 'bad.json'), '{', 'utf8')
    expect((await store.listServices('s1')).map((s) => s.id)).toEqual(['svc1'])
    expect((await store.listServicesAll()).map((s) => s.id)).toEqual(['svc1'])
    expect((await store.listTemplates('role')).map((t) => t.id)).toEqual(['r1'])
    expect((await store.listRuns('f1')).map((r) => r.id)).toEqual(['run-1'])
    // 非列表读取（getWorkflow）对损坏文件仍保留可诊断性：不伪装成不存在
    await expect(store.getWorkflow('s1', 'bad')).rejects.toMatchObject({ name: 'CorruptJsonError' })
  })
})

// JSON 合法但形状不是该资源文档：列表读必须跳过并告警，单资源读必须抛带路径的错误。
// 为什么这条与上面的「损坏 JSON」分开：两类原因不同（解析失败 vs 形状不匹配），
// 修法也不同；合成一条会掩盖其中之一。
describe('形状守卫：JSON 合法但不是该资源的文档', () => {
  it('列表读跳过形状不匹配的文件并告警（可解析的 123/[]/{} 不再流进列表）', async () => {
    await store.saveWorkflow(makeFlow('good', 's1'), 's1')
    await store.saveService(makeService('svc1', 's1'), 's1')
    await store.saveTemplate('role', makeRoleTemplate('r1'))
    await store.saveFlowTemplate(makeFlow('tpl1', 's1'))
    await store.saveRun({
      id: 'run-1', flowId: 'f1', flowName: '流程', sessionId: 's1', mode: 'mode1', status: 'completed',
      startedAt: '2026-08-24T00:00:00.000Z', endedAt: null, summary: '', nodes: [],
    })
    await writeFile(join(dir, 'workflows', 'shape.json'), '123', 'utf8')
    await writeFile(join(dir, 'services', 'shape.json'), '[]', 'utf8')
    await writeFile(join(dir, 'roles', 'shape.json'), '"文字"', 'utf8')
    await writeFile(join(dir, 'flow-templates', 'shape.json'), '{}', 'utf8')
    await writeFile(join(dir, 'runs', 'shape.json'), 'true', 'utf8')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect((await store.listWorkflows('s1')).map((f) => f.id)).toEqual(['good'])
      expect((await store.listServices('s1')).map((s) => s.id)).toEqual(['svc1'])
      expect((await store.listServicesAll()).map((s) => s.id)).toEqual(['svc1'])
      expect((await store.listTemplates('role')).map((t) => t.id)).toEqual(['r1'])
      expect((await store.listFlowTemplates()).map((t) => t.id)).toEqual(['tpl1'])
      expect((await store.listRuns('f1')).map((r) => r.id)).toEqual(['run-1'])
      // 每个被跳过的文件都留下一条告警：静默跳过会把「数据损坏」退化成空列表
      for (const relative of ['workflows', 'services', 'roles', 'flow-templates', 'runs']) {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(join(relative, 'shape.json')))
      }
      // services 目录被 listServices 与 listServicesAll 各扫一次，故告警比文件数多一条
      expect(warn).toHaveBeenCalledTimes(6)
    } finally {
      warn.mockRestore()
    }
  })

  it('单资源读遇到形状不匹配抛带路径的 InvalidDocumentError', async () => {
    await writeFile(join(dir, 'workflows', 'shape.json'), '[]', 'utf8')
    await expect(store.getWorkflow('s1', 'shape')).rejects.toMatchObject({
      name: 'InvalidDocumentError',
      filePath: join(dir, 'workflows', 'shape.json'),
    })
  })

  it('service/template/flow-template/run 的单资源读同样抛形状错误且带各自路径', async () => {
    await writeFile(join(dir, 'services', 'shape.json'), '{}', 'utf8')
    await writeFile(join(dir, 'roles', 'shape.json'), '"文字"', 'utf8')
    await writeFile(join(dir, 'flow-templates', 'shape.json'), '[]', 'utf8')
    await writeFile(join(dir, 'runs', 'shape.json'), '123', 'utf8')

    const reads: Array<() => Promise<unknown>> = [
      () => store.getServiceById('shape'),
      () => store.getService('s1', 'shape'),
      () => store.getTemplate('role', 'shape'),
      () => store.getFlowTemplate('shape'),
      () => store.getRun('shape'),
    ]
    for (const read of reads) {
      await expect(read()).rejects.toMatchObject({ name: 'InvalidDocumentError' })
    }
    await expect(store.getServiceById('shape')).rejects.toMatchObject({
      filePath: join(dir, 'services', 'shape.json'),
    })
  })
})

describe('模板 CRUD（全局共享）与子类过滤', () => {
  it('角色/文件/数据库三类模板增删查', async () => {
    const role = makeRoleTemplate('r1')
    await store.saveTemplate('role', role)
    const fileT: FileTemplate = { id: 'ft1', name: '文本', fileKind: 'text', content: '内容' }
    await store.saveTemplate('file', fileT)
    const dbT: DatabaseTemplate = { id: 'dt1', name: '库', description: 'd', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/x.db' }
    await store.saveTemplate('database', dbT)

    expect((await store.listTemplates('role')).map((t) => t.id)).toEqual(['r1'])
    expect((await store.listTemplates('file')).map((t) => t.id)).toEqual(['ft1'])
    expect((await store.listTemplates('database')).map((t) => t.id)).toEqual(['dt1'])

    expect(await store.deleteTemplate('role', 'r1')).toBe(true)
    expect(await store.deleteTemplate('role', 'r1')).toBe(false)
    expect(await store.listTemplates('role')).toEqual([])
  })

  it('模板全局共享：任意会话可见（Q23）', async () => {
    await store.saveTemplate('role', makeRoleTemplate('r1'))
    // 模板 API 无会话维度，直接可见
    expect((await store.listTemplates('role')).length).toBe(1)
  })

  it('Team 模板增删查（groups/ 目录，全局共享）', async () => {
    const group: GroupTemplate = { id: 'gt1', name: '审查组', collabPrompt: '你们是双 Agent Team' }
    await store.saveTemplate('group', group)
    expect((await store.listTemplates('group')).map((t) => t.id)).toEqual(['gt1'])
    expect(await store.getTemplate('group', 'gt1')).not.toBeNull()

    // 删除后列表为空（模板与画布节点深拷贝解耦：删模板不影响已生成节点）
    expect(await store.deleteTemplate('group', 'gt1')).toBe(true)
    expect(await store.listTemplates('group')).toEqual([])
  })

  it('单资源读 getTemplate：file/database 同目录混存时按字段判别，不串类', async () => {
    const fileT: FileTemplate = { id: 'dt-mix', name: '文本', fileKind: 'text', content: 'x' }
    const dbT: DatabaseTemplate = { id: 'dt-mix2', name: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/x.db' }
    await store.saveTemplate('file', fileT)
    await store.saveTemplate('database', dbT)

    expect(await store.getTemplate('file', 'dt-mix')).not.toBeNull()
    expect(await store.getTemplate('database', 'dt-mix2')).not.toBeNull()
    // 同 id 但类型不符：按子类判别返回 null（不把库模板当文件模板返回）
    const other: DatabaseTemplate = { id: 'dt-dup', name: '库2', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/y.db' }
    await store.saveTemplate('database', other)
    expect(await store.getTemplate('file', 'dt-dup')).toBeNull()
  })

  it('单资源读 getTemplate 对损坏 JSON 抛 CorruptJsonError（不伪装成不存在）', async () => {
    await writeFile(join(dir, 'roles', 'broken.json'), '{ broken json', 'utf8')
    await expect(store.getTemplate('role', 'broken')).rejects.toMatchObject({ name: 'CorruptJsonError' })
    // 列表读仍跳过损坏项（可用性优先），不阻塞同目录其他模板
    await store.saveTemplate('role', makeRoleTemplate('r-ok'))
    expect((await store.listTemplates('role')).map((t) => t.id)).toEqual(['r-ok'])
  })

  it('saveTemplate 时间戳记账：缺省保留既有 createdAt，updatedAt 恒刷新', async () => {
    const first = await store.saveTemplate('role', makeRoleTemplate('r-ts'))
    const createdAt = (first as { createdAt: string }).createdAt
    // 第二次保存不携带 createdAt（如导入路径）：必须保留既有创建时间
    await store.saveTemplate('role', { ...makeRoleTemplate('r-ts'), name: '改名' })
    const saved = (await store.getTemplate('role', 'r-ts')) as { createdAt: string; updatedAt: string; name: string }
    expect(saved.name).toBe('改名')
    expect(saved.createdAt).toBe(createdAt)
    expect(Date.parse(saved.updatedAt)).toBeGreaterThanOrEqual(Date.parse(createdAt))
  })

  it('saveTemplate 经发布策略剥除前端临时标记（不落盘）', async () => {
    await store.saveTemplate('role', { ...makeRoleTemplate('r-clean'), _draft: true } as RoleTemplate)
    const disk = JSON.parse(await readFile(join(dir, 'roles', 'r-clean.json'), 'utf8')) as Record<string, unknown>
    expect(disk).not.toHaveProperty('_draft')
  })
})

describe('运行历史（runs/<runId>.json）', () => {
  function makeRun(id: string, flowId: string, status: RunSnapshot['status'] = 'completed'): RunSnapshot {
    return {
      id,
      flowId,
      flowName: '流程',
      sessionId: 's1',
      mode: 'mode1',
      status,
      startedAt: new Date().toISOString(),
      endedAt: null,
      summary: '',
      nodes: [],
    }
  }

  it('保存→读取→按 flowId 过滤→exists→全量扫描', async () => {
    await store.saveRun(makeRun('run-1', 'f1'))
    await store.saveRun(makeRun('run-2', 'f1'))
    await store.saveRun(makeRun('run-3', 'f2'))
    expect((await store.listRuns('f1')).map((r) => r.id).sort()).toEqual(['run-1', 'run-2'].sort())
    expect((await store.listRuns('f2')).map((r) => r.id)).toEqual(['run-3'])
    expect(await store.getRun('run-1')).not.toBeNull()
    expect(await store.getRun('ghost')).toBeNull()
    expect((await store.listAllRuns()).map((r) => r.id).sort()).toEqual(['run-1', 'run-2', 'run-3'].sort())
  })

  it('Bug 14：listRuns 可按 sessionId 过滤（跨会话历史不可见）', async () => {
    const a = { ...makeRun('run-1', 'f1'), sessionId: 's1' }
    const b = { ...makeRun('run-2', 'f1'), sessionId: 's2' } // 另一会话的同名工作流 run
    await store.saveRun(a)
    await store.saveRun(b)
    // 传 sessionId 时只返回该会话的记录
    expect((await store.listRuns('f1', 's1')).map((r) => r.id)).toEqual(['run-1'])
    expect((await store.listRuns('f1', 's2')).map((r) => r.id)).toEqual(['run-2'])
    // 不传（旧语义）仍返回全部（resume 内部定位用）
    expect((await store.listRuns('f1')).map((r) => r.id).sort()).toEqual(['run-1', 'run-2'].sort())
  })
})

describe('工具组合（combos.json）', () => {
  function combo(id: string): ToolCombo {
    return { id: id as `combo-${string}`, name: '组合', tools: ['wf_ask'], mcpServers: [] }
  }

  it('保存→列出→删除；id 必须 combo- 前缀', async () => {
    await store.saveToolCombo(combo('combo-a'))
    await store.saveToolCombo(combo('combo-b'))
    expect((await store.listToolCombos()).map((c) => c.id).sort()).toEqual(['combo-a', 'combo-b'].sort())
    await expect(store.saveToolCombo({ id: 'bad', name: 'x', tools: [], mcpServers: [] } as unknown as ToolCombo)).rejects.toThrow()
    expect(await store.deleteToolCombo('combo-a')).toBe(true)
    expect(await store.deleteToolCombo('combo-a')).toBe(false)
  })

  it('combos 非数组：读写都抛带路径的形状错误（不把非数组展开成垃圾数据）', async () => {
    await writeFile(join(dir, 'combos.json'), JSON.stringify({ combos: 'combo-a' }), 'utf8')
    await expect(store.listToolCombos()).rejects.toMatchObject({
      name: 'InvalidDocumentError',
      filePath: join(dir, 'combos.json'),
    })
    await expect(store.saveToolCombo(combo('combo-a'))).rejects.toMatchObject({ name: 'InvalidDocumentError' })
    await expect(store.deleteToolCombo('combo-a')).rejects.toMatchObject({ name: 'InvalidDocumentError' })
  })
})

describe('userId → sessionId 映射（§4.1.3 规则 7）', () => {
  it('合并写入→读取→持久化（新实例可见）', async () => {
    await store.mergeUserIdMap('svc1', { u1: 'sess-a', u2: 'sess-b' })
    const map = await store.userIdMap('svc1')
    expect(map).toEqual({ u1: 'sess-a', u2: 'sess-b' })
    // 新 FlowStore 实例（模拟服务重启后重新加载）读取同一映射
    const store2 = new FlowStore(dir)
    expect(await store2.userIdMap('svc1')).toEqual({ u1: 'sess-a', u2: 'sess-b' })
    // 读取返回副本：调用方修改不影响落盘
    const map2 = await store.userIdMap('svc1')
    map2.u1 = 'hacked'
    expect(await store.userIdMap('svc1')).toEqual({ u1: 'sess-a', u2: 'sess-b' })
  })

  it('合并写入是读改写同临界区：并发不同 userId 首解析互不覆盖', async () => {
    // 映射写入必须走 mergeUserIdMap（单锁内 read-modify-write）；若拆成「先读再整表写回」，
    // 不同 userId 并发首解析会相互覆盖（SessionMap 的并发用例覆盖该语义，此处锁定 storage 契约）。
    const merged = await Promise.all([
      store.mergeUserIdMap('svc-c', { 'user-1': 'sess-1' }),
      store.mergeUserIdMap('svc-c', { 'user-2': 'sess-2' }),
      store.mergeUserIdMap('svc-c', { 'user-3': 'sess-3' }),
    ])
    expect(merged.length).toBe(3)
    const disk = JSON.parse(await readFile(join(dir, 'services', 'svc-c.sessions.json'), 'utf8')) as Record<string, string>
    expect(Object.keys(disk).sort()).toEqual(['user-1', 'user-2', 'user-3'])
  })

  it('映射内容形状不合法：告警并按空映射降级（不阻断该服务的会话解析）', async () => {
    await writeFile(join(dir, 'services', 'svc-bad.sessions.json'), JSON.stringify({ u1: 42 }), 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await store.userIdMap('svc-bad')).toEqual({})
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(join('services', 'svc-bad.sessions.json')))
    } finally {
      warn.mockRestore()
    }
    // 降级不是终态：下一次合并写入即覆盖为合法映射（自愈）
    expect(await store.mergeUserIdMap('svc-bad', { u2: 'sess-b' })).toEqual({ u2: 'sess-b' })
  })
})

describe('原子性与锁一致性', () => {
  it('并发保存同一工作流：无垃圾临时文件、无撕裂、revision 严格递增', async () => {
    const flow = makeFlow('f1', 's1')
    await store.saveWorkflow(flow, 's1')
    // 并发追加写（不携带 expectedRevision）：每次读改写都在锁内完成，revision 依次递增
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.saveWorkflow({ ...flow, name: `并发-${i}` }, 's1')),
    )
    // 契约口径：只锁「初始 1 + 10 次追加 = 11」，不锁「每次并发写各拿到不同 revision」——
    // 合法实现若合并/重排写入（只要不丢更新）不应误红。
    const final = await store.getWorkflow('s1', 'f1')
    expect(final!.revision).toBe(11)
    expect(final!.name).toMatch(/^并发-/)
    // 每个并发调用返回的仍是该次保存的完整文档（无撕裂），revision 落在本次并发区间内
    for (const saved of results) {
      expect(saved.id).toBe('f1')
      expect(saved.sessionId).toBe('s1')
      expect(Number.isInteger(saved.revision)).toBe(true)
      expect(saved.revision).toBeGreaterThanOrEqual(1)
      expect(saved.revision).toBeLessThanOrEqual(11)
    }
    // 目录契约口径：无临时文件/锁文件残留 + 目标文件存在（不锁「目录里只允许出现该文件」）
    const files = await readdir(join(dir, 'workflows'))
    expect(files.filter((f) => f.startsWith('.tmp') || f.endsWith('.lock')), '不应残留临时文件或锁文件').toEqual([])
    expect(files, '目标工作流文件必须存在').toContain('f1.json')
  })

  it('并发带陈旧期望的保存按乐观锁拒绝（其余不受影响）', async () => {
    const first = await store.saveWorkflow(makeFlow('f1', 's1'), 's1')
    await store.saveWorkflow({ ...first, name: '抢先' }, 's1') // revision 2
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => store.saveWorkflow({ ...first, name: '旧快照' }, 's1', { expectedRevision: 1 })),
    )
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected.length).toBe(5) // 全部被乐观锁拒绝
    expect((await store.getWorkflow('s1', 'f1'))!.revision).toBe(2) // 未被任何旧快照覆盖
  })

  it('不同资源并发写互不干扰', async () => {
    await Promise.all([
      store.saveWorkflow(makeFlow('f1', 's1'), 's1'),
      store.saveWorkflow(makeFlow('f2', 's1'), 's1'),
      store.saveTemplate('role', makeRoleTemplate('r1')),
      store.saveToolCombo({ id: 'combo-x', name: 'x', tools: [], mcpServers: [] }),
    ])
    expect((await store.listWorkflows('s1')).length).toBe(2)
    expect((await store.listTemplates('role')).length).toBe(1)
    expect((await store.listToolCombos()).length).toBe(1)
  })
})

describe('工作流模板 CRUD（图2 交互改造：flow-templates/ 全局共享）', () => {
  function makeTemplate(id: string, name: string, mode: 'mode1' | 'mode2' = 'mode1') {
    return {
      id,
      mode,
      name,
      description: '',
      revision: 0,
      nodes: [],
      lines: [],
    }
  }

  it('保存/列出/读取：mode 过滤按需，模板全局共享不隔离', async () => {
    await store.saveFlowTemplate(makeTemplate('tpl-1', '流程模板'))
    await store.saveFlowTemplate(makeTemplate('tpl-2', '服务模板', 'mode2'))
    const all = await store.listFlowTemplates()
    expect(all.map((t) => t.id).sort()).toEqual(['tpl-1', 'tpl-2'])
    expect((await store.getFlowTemplate('tpl-1'))?.name).toBe('流程模板')
    // 模板无 sessionId 隔离：不传会话也能读到（全局共享语义）
    expect((await store.getFlowTemplate('tpl-2'))?.mode).toBe('mode2')
  })

  it('revision 递增 + 乐观锁冲突保护（与实例同语义）', async () => {
    const saved = await store.saveFlowTemplate(makeTemplate('tpl-3', '模板A'))
    expect(saved.revision).toBe(1)
    await store.saveFlowTemplate({ ...makeTemplate('tpl-3', '模板A改'), revision: 1 }, { expectedRevision: 1 })
    await expect(
      store.saveFlowTemplate({ ...makeTemplate('tpl-3', '旧快照'), revision: 1 }, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'FLOW_REVISION_CONFLICT' })
  })

  it('删除仅删模板文件，不影响已生成的实例（解耦语义）', async () => {
    await store.saveFlowTemplate(makeTemplate('tpl-4', '模板'))
    // 同名实例独立保存（实例属会话，模板全局——两者互不干扰）
    await store.saveWorkflow({ ...makeFlow('f-tpl', 's1'), name: '模板' }, 's1')
    expect(await store.deleteFlowTemplate('tpl-4')).toBe(true)
    expect(await store.getFlowTemplate('tpl-4')).toBeNull()
    // 实例仍在
    expect((await store.getWorkflow('s1', 'f-tpl'))?.name).toBe('模板')
  })
})

// ---------------------------------------------------------------------------
// P4 代理补丁标注的服务端字段语义（lastPatch）
// ---------------------------------------------------------------------------

describe('FlowStore · P4 lastPatch（用户保存清除，补丁路径保留）', () => {
  const patch = { origin: 'agent' as const, at: '2026-09-01T00:00:00.000Z', nodeIds: ['a'] }

  it('用户保存（缺省）：清除 lastPatch（服务端字段不随客户端快照回写）', async () => {
    const flow = { ...makeFlow('wf-mark', 's-1'), lastPatch: patch } as WorkflowDocument
    await store.saveWorkflow(flow, 's-1', { force: true })
    const saved = await store.getWorkflow('s-1', 'wf-mark')
    expect((saved as { lastPatch?: unknown } | null)?.lastPatch).toBeUndefined()
  })

  it('keepServerFields=true（补丁工具路径）：保留 lastPatch', async () => {
    const flow = { ...makeFlow('wf-mark2', 's-1'), lastPatch: patch } as WorkflowDocument
    await store.saveWorkflow(flow, 's-1', { force: true, keepServerFields: true })
    const saved = await store.getWorkflow('s-1', 'wf-mark2')
    expect((saved as { lastPatch?: unknown } | null)?.lastPatch).toEqual(patch)
  })

  it('模板同样：缺省清除、keepServerFields 保留', async () => {
    const base = { id: 'tpl-mark', mode: 'mode1' as const, name: 'T', description: '', nodes: [], lines: [], lastPatch: patch }
    await store.saveFlowTemplate({ ...base, id: 'tpl-mark-a' }, { force: true })
    await store.saveFlowTemplate({ ...base, id: 'tpl-mark-b' }, { force: true, keepServerFields: true })
    expect((await store.getFlowTemplate('tpl-mark-a') as { lastPatch?: unknown } | null)?.lastPatch).toBeUndefined()
    expect((await store.getFlowTemplate('tpl-mark-b') as { lastPatch?: unknown } | null)?.lastPatch).toEqual(patch)
  })
})

// ---------------------------------------------------------------------------
// 写路径的会话归属校验（读/删两侧早有，写侧补齐）
// ---------------------------------------------------------------------------

describe('saveWorkflow 的会话归属校验', () => {
  it('跨会话写同一 flowId → 拒绝（稳定码），且磁盘归属与内容保持不变', async () => {
    await store.saveWorkflow(makeFlow('flow-1', 'session-1'), 'session-1', { force: true })

    await expect(
      store.saveWorkflow(makeFlow('flow-1', 'session-2', '他人的改名'), 'session-2', { force: true }),
    ).rejects.toMatchObject({ code: 'FLOW_NOT_FOUND' })

    const still = await store.getWorkflow('session-1', 'flow-1')
    expect(still?.name).toBe('流程')
    expect(still?.sessionId).toBe('session-1')
    // 覆盖者会话读不到该文档（归属未被翻转）
    expect(await store.getWorkflow('session-2', 'flow-1')).toBeNull()
  })

  it('同会话重复保存照旧放行（归属校验不阻断正常更新）', async () => {
    await store.saveWorkflow(makeFlow('flow-1', 'session-1'), 'session-1', { force: true })
    const updated = await store.saveWorkflow(makeFlow('flow-1', 'session-1', '改名'), 'session-1', { force: true })
    expect(updated.name).toBe('改名')
    expect(updated.revision).toBe(2)
  })

  it('磁盘上不存在（current === null）视为新建：任何会话都能用新 id 创建', async () => {
    const created = await store.saveWorkflow(makeFlow('flow-new', 'session-9'), 'session-9', { force: true })
    expect(created.sessionId).toBe('session-9')
    expect(await store.getWorkflow('session-9', 'flow-new')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 列表排序的确定性：一律码位序，不依赖 locale/ICU
// ---------------------------------------------------------------------------

/** 码位序期望值（与 localeCompare 不同：'A' < 'a' < '中'）。 */
function codepointSorted(values: string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

describe('列表排序的确定性', () => {
  it('工作流列表按 updatedAt 倒序且不丢项（排序方向与稳定性）', async () => {
    for (let index = 0; index < 3; index += 1) {
      await store.saveWorkflow(makeFlow(`flow-${index}`, 'session-1', `流程-${index}`), 'session-1', { force: true })
      // 保证 updatedAt 严格递增（同毫秒会让顺序不可判别）
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    const listed = await store.listWorkflows('session-1')
    const stamps = listed.map((item) => String(item.updatedAt))
    expect(stamps).toEqual([...stamps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).reverse())
    expect(new Set(stamps).size).toBe(stamps.length)
  })

  it('角色模板列表按名称码位序（不再随 locale/ICU 变化）', async () => {
    const names = ['zeta', 'Alpha', 'alpha', '中文本']
    for (const [index, name] of names.entries()) {
      await store.saveTemplate('role', {
        id: `role-${index}`,
        kind: 'agent',
        name,
        systemPrompt: 'x',
        provider: '',
        model: '',
        presetId: 'combo-1',
        retryLimit: 3,
      } as never)
    }
    const listed = await store.listTemplates('role')
    expect(listed.map((item) => String((item as { name?: string }).name))).toEqual(codepointSorted(names))
  })
})

// ---------------------------------------------------------------------------
// IF-12 列表读取的错误语义：目录不存在（ENOENT）降级为空，其他失败一律上浮
// （storage/AGENTS.md：列表读可用，但不得把权限等读取失败伪装成空列表）
// ---------------------------------------------------------------------------

describe('列表读取的错误语义', () => {
  it('目录不存在 → 各列表入口都返回空（合法降级，不抛错）', async () => {
    for (const name of ['workflows', 'services', 'roles', 'data', 'groups', 'flow-templates', 'runs']) {
      await rm(join(dir, name), { recursive: true, force: true })
    }
    expect(await store.listWorkflows()).toEqual([])
    expect(await store.listServices()).toEqual([])
    expect(await store.listServicesAll()).toEqual([])
    expect(await store.listTemplates('role')).toEqual([])
    expect(await store.listTemplates('file')).toEqual([])
    expect(await store.listTemplates('database')).toEqual([])
    expect(await store.listTemplates('group')).toEqual([])
    expect(await store.listFlowTemplates()).toEqual([])
    expect(await store.listRuns('flow-1')).toEqual([])
    expect(await store.listAllRuns()).toEqual([])
  })

  it('目录不可枚举（ENOTDIR，代指权限等非 ENOENT 失败）→ 上浮可诊断错误，不伪装成空列表', async () => {
    // 用「目录项被同名文件占位」造出确定性的非 ENOENT 失败（Windows/POSIX 同为 ENOTDIR），
    // 避免依赖平台相关的权限 ACL 才能复现权限失败。
    await rm(join(dir, 'workflows'), { recursive: true, force: true })
    await writeFile(join(dir, 'workflows'), 'not a directory')
    await expect(store.listWorkflows()).rejects.toMatchObject({ code: 'ENOTDIR' })

    await rm(join(dir, 'roles'), { recursive: true, force: true })
    await writeFile(join(dir, 'roles'), 'not a directory')
    await expect(store.listTemplates('role')).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
