// tests/host/flow-store.test.ts
//
// FlowStore 数据层测试（T-012）：全 CRUD、会话隔离（workflow/service 按 sessionId）、
// revision 冲突保护、原子性与锁一致性（并发保存无撕裂/无垃圾文件）、userId 映射持久化、
// 编排事实源、模板深拷贝解耦（§4.2.1）。断言依据：架构文档 §4.1 + 需求文档 §4.2.2/§4.7/§6。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore, FlowRevisionConflictError, type TemplateKind } from '../../src/host/storage/flow-store.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'
import type { ServiceState, RoleTemplate, FileTemplate, DatabaseTemplate, ToolCombo, RunSnapshot } from '../../src/host/shared/types.js'
import { newRoleNode, newStageNode, newLine } from '../../src/host/graph/model.js'

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
  it('创建全部规划目录（§6 目录规划）', async () => {
    const names = await readdir(dir)
    for (const d of FlowStore.DIRS) {
      expect(names).toContain(d.split('/')[0])
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
    await store.saveUserIdMap('svc1', { u1: 'sess-1' })
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

  it('templateToNode 深拷贝解耦：模板后续修改不影响节点（§4.2.1）', async () => {
    const role = makeRoleTemplate('r1')
    await store.saveTemplate('role', role)
    const node = store.templateToNode(role, 'node-1', { x: 1, y: 2 })
    expect(node).not.toBeNull()
    expect(node!.kind).toBe('agent')
    expect(node!.id).toBe('node-1')
    expect(node!.position).toEqual({ x: 1, y: 2 })
    // 修改模板 → 节点不受影响（深拷贝断引用）
    role.systemPrompt = '改后'
    expect((node as { data: { systemPrompt: string } }).data.systemPrompt).toBe('p')

    const dbT: DatabaseTemplate = { id: 'dt1', name: '库', description: 'd', dbType: 'server', dbKind: 'mysql', conn: { host: 'h', port: 3306, user: 'u', password: 'p', db: 'x' } }
    const dbNode = store.templateToNode(dbT, 'node-2', { x: 0, y: 0 })
    expect(dbNode!.kind).toBe('database')
    expect((dbNode as { data: { label: string } }).data.label).toBe('库')

    const fileT: FileTemplate = { id: 'ft1', name: '文件', fileKind: 'file', managedPath: 'data/files/a.pdf' }
    const fileNode = store.templateToNode(fileT, 'node-3', { x: 0, y: 0 })
    expect(fileNode!.kind).toBe('file')
    expect((fileNode as { data: { fileName: string } }).data.fileName).toBe('a.pdf')
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

  it('保存→读取→按 flowId 过滤→exists→全量 id 扫描', async () => {
    await store.saveRun(makeRun('run-1', 'f1'))
    await store.saveRun(makeRun('run-2', 'f1'))
    await store.saveRun(makeRun('run-3', 'f2'))
    expect((await store.listRuns('f1')).map((r) => r.id).sort()).toEqual(['run-1', 'run-2'].sort())
    expect((await store.listRuns('f2')).map((r) => r.id)).toEqual(['run-3'])
    expect(await store.getRun('run-1')).not.toBeNull()
    expect(await store.runExists('run-1')).toBe(true)
    expect(await store.runExists('ghost')).toBe(false)
    expect((await store.listAllRunIds()).sort()).toEqual(['run-1', 'run-2', 'run-3'].sort())
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
})

describe('userId → sessionId 映射（§4.1.3 规则 7）', () => {
  it('保存→读取→持久化（新实例可见）', async () => {
    await store.saveUserIdMap('svc1', { u1: 'sess-a', u2: 'sess-b' })
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
})

describe('编排事实源（orchestrations/<runId>.json）', () => {
  it('保存→读取→删除', async () => {
    const flow = makeFlow('f1', 's1')
    await store.saveOrchestration('run-1', flow)
    expect(await store.readOrchestration('run-1')).not.toBeNull()
    expect(await store.deleteOrchestration('run-1')).toBe(true)
    expect(await store.readOrchestration('run-1')).toBeNull()
    expect(await store.deleteOrchestration('run-1')).toBe(false)
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
    const revs = results.map((r) => r.revision)
    expect(new Set(revs).size).toBe(10) // 10 次并发写各自拿到不同 revision（锁串行化）
    // 最终文件为完整 JSON
    const final = await store.getWorkflow('s1', 'f1')
    expect(final!.revision).toBe(11)
    expect(final!.name).toMatch(/^并发-/)
    // 无 .tmp-* 垃圾残留（原子写清理）
    const files = await readdir(join(dir, 'workflows'))
    expect(files).toEqual(['f1.json'])
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
