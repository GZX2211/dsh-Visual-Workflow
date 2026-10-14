// tests/host/transfer/bundle.test.ts
//
// 导入导出领域单测（src/host/transfer/bundle.ts）：v2 bundle 往返、名称冲突策略
// （conflict / rename / overwrite）、嵌入式资源（roles/files/databases/combos）重建、
// embedded.groups 内联语义与稳定领域错误码。
//
// 断言对象是领域行为（bundle 形状与落库结果），不涉及 HTTP 层：领域码 → HTTP 状态
// 的映射在 tests/host/api/routes.test.ts 覆盖。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  exportAgentTemplate,
  exportWorkflowBundle,
  importAgentTemplate,
  importWorkflowBundle,
} from '../../../src/host/transfer/bundle.js'
import type { DatabaseNode } from '../../../src/host/shared/graph-model.js'
import {
  agent,
  cleanupAll,
  databaseTemplate,
  fileTemplate,
  makeFlow,
  makeFlowWithGroup,
  makeStore,
  roleTemplate,
  stage,
} from './fixtures/flow-fixtures.js'

afterEach(cleanupAll)

describe('工作流 bundle 导出/导入（mode1）', () => {
  it('导出为 v2 bundle；冲突返回 conflict，rename 新建、overwrite 覆盖', async () => {
    const store = await makeStore()
    await store.saveWorkflow(makeFlow(), 'session-1', { force: true })

    const json = await exportWorkflowBundle(store, 'session-1', 'flow-1')
    const bundle = JSON.parse(json) as { format?: string; version?: number; workflow?: { name?: string } }
    expect(bundle.format).toBe('dsh-vw-bundle')
    expect(bundle.version).toBe(2)

    // 首次导入：模板库为空 → 直接创建模板（不落实例）
    const first = (await importWorkflowBundle(store, json)) as { template?: { id?: string; name?: string } }
    expect(first.template?.name).toBe('测试流程')
    expect((await store.listWorkflows('session-1')).length).toBe(1) // 实例数不变
    expect((await store.listFlowTemplates()).length).toBe(1)

    // 二次导入同名单 → conflict（模板库重名判定）
    const conflict = (await importWorkflowBundle(store, json)) as { conflict?: boolean; existingName?: string }
    expect(conflict.conflict).toBe(true)
    expect(conflict.existingName).toBe('测试流程')

    // rename → 新名称模板
    const renamed = (await importWorkflowBundle(store, json, { conflictMode: 'rename' })) as {
      template?: { id?: string; name?: string }
    }
    expect(renamed.template?.name).toBe('测试流程 (2)')
    expect((await store.listWorkflows('session-1')).length).toBe(1) // 实例数不变
    expect((await store.listFlowTemplates()).length).toBe(2)

    // overwrite → 覆盖同名模板（'测试流程'；数量不变，id 保持为首个模板 id）
    const firstId = first.template?.id
    const overwritten = (await importWorkflowBundle(store, json, { conflictMode: 'overwrite' })) as {
      template?: { id?: string }
    }
    expect(overwritten.template?.id).toBe(firstId)
    expect((await store.listFlowTemplates()).length).toBe(2)
  })

  it('模式二服务导出/导入往返（service 字段、落到 mode2 模板、冲突语义）', async () => {
    const store = await makeStore()
    const service = {
      id: 'svc-1',
      sessionId: 'session-1',
      mode: 'mode2',
      name: '示例服务',
      description: '服务描述',
      revision: 0,
      status: 'stopped',
      nodes: [agent('n-a', '子'), stage('n-start', 'start'), stage('n-end', 'end')],
      lines: [],
    } as never
    await store.saveService(service, 'session-1', { force: true })

    const json = await exportWorkflowBundle(store, 'session-1', 'svc-1')
    const bundle = JSON.parse(json) as { format?: string; mode?: string; service?: { name?: string } }
    expect(bundle.format).toBe('dsh-vw-bundle')
    expect(bundle.mode).toBe('mode2')
    expect(bundle.service?.name).toBe('示例服务')

    // 首次导入 → mode2 模板（模板库为空不 conflict）
    const first = (await importWorkflowBundle(store, json)) as { template?: { name?: string; mode?: string } }
    expect(first.template?.name).toBe('示例服务')
    expect(first.template?.mode).toBe('mode2')
    expect((await store.listServices('session-1')).length).toBe(1) // 服务实例不变
    expect((await store.listFlowTemplates()).length).toBe(1)

    // 同名单 → conflict；rename → 新名称 mode2 模板
    const conflict = (await importWorkflowBundle(store, json)) as { conflict?: boolean }
    expect(conflict.conflict).toBe(true)
    const renamed = (await importWorkflowBundle(store, json, { conflictMode: 'rename' })) as { template?: { name?: string; mode?: string } }
    expect(renamed.template?.name).toBe('示例服务 (2)')
    expect(renamed.template?.mode).toBe('mode2')
    expect((await store.listServices('session-1')).length).toBe(1)
    expect((await store.listFlowTemplates()).length).toBe(2)
  })

  it('非法输入 → 稳定领域码（TRANSFER_INVALID_JSON / TRANSFER_INVALID_BUNDLE）', async () => {
    const store = await makeStore()
    await expect(importWorkflowBundle(store, 'not-json')).rejects.toMatchObject({ code: 'TRANSFER_INVALID_JSON' })
    await expect(importWorkflowBundle(store, JSON.stringify({ format: 'x' }))).rejects.toMatchObject({
      code: 'TRANSFER_INVALID_BUNDLE',
    })
    await expect(importWorkflowBundle(store, JSON.stringify({ format: 'dsh-vw-bundle', version: 2, mode: 'mode1' }))).rejects.toMatchObject({
      code: 'TRANSFER_INVALID_BUNDLE',
    })
  })

  it('导出目标不存在 → TRANSFER_NOT_FOUND（工作流与角色模板两条路径）', async () => {
    const store = await makeStore()
    await expect(exportWorkflowBundle(store, 'session-1', 'nope')).rejects.toMatchObject({ code: 'TRANSFER_NOT_FOUND' })
    await expect(exportAgentTemplate(store, 'nope')).rejects.toMatchObject({ code: 'TRANSFER_NOT_FOUND' })
  })
})

// D07-05：导出包是可分享产物，连接口令必须从导出产物中“剔除”（不是掩码），
// 而落盘文档与运行期（wf-db-query/driver.ts）仍以文档为事实源，不得受影响。
const SECRET = 'p@ssw0rd-secret'

function serverDatabaseNode(): DatabaseNode {
  return {
    id: 'n-db',
    kind: 'database',
    position: { x: 0, y: 0 },
    data: {
      label: '服务器库',
      description: '',
      dbType: 'server',
      dbKind: 'mysql',
      conn: { host: 'db.internal', port: 3306, user: 'root', password: SECRET, db: 'prod' },
    },
  }
}

describe('导出剔除连接凭据（D07-05）', () => {
  it('mode1：导出 bundle 不含节点口令，非密钥字段保留、落盘文档不受影响', async () => {
    const store = await makeStore()
    const flow = makeFlow()
    flow.nodes = [...flow.nodes, serverDatabaseNode()]
    await store.saveWorkflow(flow, 'session-1', { force: true })

    const json = await exportWorkflowBundle(store, 'session-1', 'flow-1')
    expect(json).not.toContain(SECRET)
    const bundle = JSON.parse(json) as {
      workflow?: { nodes?: Array<{ id?: string; data?: { conn?: Record<string, unknown> } }> }
    }
    const exported = bundle.workflow?.nodes?.find((node) => node.id === 'n-db')
    expect(exported?.data?.conn?.host).toBe('db.internal')
    expect(exported?.data?.conn?.user).toBe('root')
    expect(exported?.data?.conn !== undefined && 'password' in exported.data.conn).toBe(false)

    // 落盘文档是运行期唯一事实源：导出剔除不得回写存储
    const stored = await store.getWorkflow('session-1', 'flow-1')
    const storedNode = stored?.nodes.find((node) => node.id === 'n-db') as DatabaseNode | undefined
    expect(storedNode?.data.conn?.password).toBe(SECRET)
  })

  it('mode2：服务导出同样剔除节点口令', async () => {
    const store = await makeStore()
    const service = {
      id: 'svc-1',
      sessionId: 'session-1',
      mode: 'mode2',
      name: '示例服务',
      description: '服务描述',
      revision: 0,
      status: 'stopped',
      nodes: [serverDatabaseNode(), ...makeFlow().nodes],
      lines: [],
    } as never
    await store.saveService(service, 'session-1', { force: true })

    const json = await exportWorkflowBundle(store, 'session-1', 'svc-1')
    expect(json).not.toContain(SECRET)
    const bundle = JSON.parse(json) as { service?: { nodes?: Array<{ id?: string; data?: { conn?: Record<string, unknown> } }> } }
    const exported = bundle.service?.nodes?.find((node) => node.id === 'n-db')
    expect(exported?.data?.conn?.host).toBe('db.internal')
    expect(exported?.data?.conn !== undefined && 'password' in exported.data.conn).toBe(false)
  })

  it('嵌入式数据库模板的连接口令不随包导出', async () => {
    const store = await makeStore()
    await store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await store.saveTemplate('database', {
      id: 'db-1',
      name: '生产库',
      description: '',
      dbType: 'server',
      dbKind: 'mysql',
      conn: { host: 'db.internal', port: 3306, user: 'root', password: SECRET, db: 'prod' },
    } as never)

    const json = await exportWorkflowBundle(store, 'session-1', 'flow-1')
    expect(json).not.toContain(SECRET)
    const bundle = JSON.parse(json) as { embedded?: { databases?: Array<{ conn?: Record<string, unknown> }> } }
    const exported = bundle.embedded?.databases?.[0]
    expect(exported?.conn?.host).toBe('db.internal')
    expect(exported?.conn !== undefined && 'password' in exported.conn).toBe(false)

    // 模板库同样不受导出影响
    const storedTemplate = await store.getTemplate('database', 'db-1') as { conn?: { password?: string } } | null
    expect(storedTemplate?.conn?.password).toBe(SECRET)
  })
})

describe('bundle 嵌入资源（roles/files/databases/combos）', () => {
  it('导出携带三类模板；导入到全新数据目录时重建模板库并回报 importedTemplates', async () => {
    const source = await makeStore()
    await source.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await source.saveTemplate('role', roleTemplate() as never)
    await source.saveTemplate('file', fileTemplate() as never)
    await source.saveTemplate('database', databaseTemplate() as never)

    const json = await exportWorkflowBundle(source, 'session-1', 'flow-1')
    const bundle = JSON.parse(json) as {
      embedded?: { roles?: Array<{ id?: string }>; files?: Array<{ id?: string }>; databases?: Array<{ id?: string }> }
    }
    // 导出必须包含三类模板（架构文档 §6.4 embedded 逐字段）
    expect(bundle.embedded?.roles?.map((t) => t.id)).toEqual(['role-1'])
    expect(bundle.embedded?.files?.map((t) => t.id)).toEqual(['file-1'])
    expect(bundle.embedded?.databases?.map((t) => t.id)).toEqual(['db-1'])

    // 导入到全新数据目录：模板库由嵌入式资源重建，计数为三类实际导入数
    const target = await makeStore()
    const imported = (await importWorkflowBundle(target, json)) as { importedTemplates?: number }
    expect(imported.importedTemplates).toBe(3)
    expect((await target.listTemplates('role')).map((t) => t.name)).toEqual(['研究员'])
    expect((await target.listTemplates('file')).map((t) => t.name)).toEqual(['资料.pdf'])
    expect((await target.listTemplates('database')).map((t) => t.name)).toEqual(['本地库'])
  })

  it('目标已有同名模板 → 重名复用、不重复入库（importedTemplates 只计新增）', async () => {
    const store = await makeStore()
    await store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await store.saveTemplate('role', roleTemplate() as never)
    await store.saveTemplate('file', fileTemplate() as never)
    await store.saveTemplate('database', databaseTemplate() as never)

    const json = await exportWorkflowBundle(store, 'session-1', 'flow-1')
    const imported = (await importWorkflowBundle(store, json, { conflictMode: 'rename' })) as { importedTemplates?: number }
    expect(imported.importedTemplates).toBe(0)
    expect(await store.listTemplates('role')).toHaveLength(1)
    expect(await store.listTemplates('file')).toHaveLength(1)
    expect(await store.listTemplates('database')).toHaveLength(1)
  })

  it('embedded.groups 随节点内联：导出可见但不重建模板库（架构文档 §6.4 语义）', async () => {
    const store = await makeStore()
    await store.saveWorkflow(makeFlowWithGroup(), 'session-1', { force: true })

    const json = await exportWorkflowBundle(store, 'session-1', 'flow-1')
    const bundle = JSON.parse(json) as { embedded?: { groups?: Array<{ id?: string; name?: string; collabPrompt?: string }> } }
    expect(bundle.embedded?.groups).toEqual([{ id: 'g1', name: 'Team 一', collabPrompt: '成员互相质询' }])

    // 导入：g1 仍随节点内联（工作流节点里可见），但不作为独立模板重建
    const target = await makeStore()
    const imported = (await importWorkflowBundle(target, json)) as { importedTemplates?: number; template?: { nodes?: Array<{ id?: string }> } }
    expect(imported.importedTemplates).toBe(0)
    expect(await target.listTemplates('group')).toEqual([])
    expect(imported.template?.nodes?.some((node) => node.id === 'g1')).toBe(true)
  })
})

describe('角色模板导出/导入（单模板 JSON）', () => {
  it('导出后可往返；同名冲突→conflict，overwrite 覆盖同一 id', async () => {
    const store = await makeStore()
    await store.saveTemplate('role', roleTemplate() as never)
    const json = await exportAgentTemplate(store, 'role-1')

    // 同名已存在 → conflict；overwrite → 成功往返（id 保持既有条目）
    const conflict = await importAgentTemplate(store, json)
    expect(conflict).toMatchObject({ conflict: true })
    const imported = (await importAgentTemplate(store, json, { conflictMode: 'overwrite' })) as { template?: { id?: string } }
    expect(imported.template?.id).toBe('role-1')
    expect(await store.listTemplates('role')).toHaveLength(1)
  })

  it('非法输入 → 稳定领域码', async () => {
    const store = await makeStore()
    await expect(importAgentTemplate(store, 'not-json')).rejects.toMatchObject({ code: 'TRANSFER_INVALID_JSON' })
    await expect(importAgentTemplate(store, JSON.stringify({ format: 'x' }))).rejects.toMatchObject({
      code: 'TRANSFER_INVALID_BUNDLE',
    })
  })
})

// ---------------------------------------------------------------------------
// 组合并入路径：快照只读一次（性能契约）与判重语义
// ---------------------------------------------------------------------------

/** 组装一份带 embedded.combos 的 v2 bundle（格式与导出产物同形）。 */
function bundleWithCombos(combos: Array<Record<string, unknown>>): string {
  const flow = makeFlow()
  return JSON.stringify({
    format: 'dsh-vw-bundle',
    version: 2,
    mode: 'mode1',
    workflow: { name: '组合导入流程', description: '', nodes: flow.nodes, lines: flow.lines },
    embedded: { roles: [], files: [], databases: [], groups: [], combos },
  })
}

describe('bundle 导入的组合并入', () => {
  it('N 个组合只读一次组合表（不再逐个组合 2N 次读盘）', async () => {
    const store = await makeStore()
    const spy = vi.spyOn(store, 'listToolCombos')
    const bundle = bundleWithCombos([
      { id: 'combo-a', name: '甲', tools: ['wf_run_node'], mcpServers: [] },
      { id: 'combo-b', name: '乙', tools: ['wf_finish'], mcpServers: [] },
      { id: 'combo-c', name: '丙', tools: [], mcpServers: ['mcp-x'] },
      { id: 'combo-d', name: '丁', tools: [], mcpServers: [] },
    ])

    await importWorkflowBundle(store, bundle)

    // 旧实现为 2N（每个组合两次），修复后为 1
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await store.listToolCombos()).map((item) => item.name).sort()).toEqual(['丁', '丙', '乙', '甲'].sort())
  })

  it('同批内同名组合只落一条；id 与已有组合冲突时换新 id（判重仍看最新快照）', async () => {
    const store = await makeStore()
    await store.saveToolCombo({ id: 'combo-taken', name: '已有', tools: [], mcpServers: [] })
    const bundle = bundleWithCombos([
      { id: 'combo-taken', name: '新甲', tools: ['wf_run_node'], mcpServers: [] },
      { id: 'combo-dup', name: '新甲', tools: ['wf_finish'], mcpServers: [] },
    ])

    await importWorkflowBundle(store, bundle)

    const combos = await store.listToolCombos()
    const 新甲 = combos.filter((item) => item.name === '新甲')
    expect(新甲).toHaveLength(1)
    // id 冲突 → 换新 id（不与已有 combo-taken 撞车）；且新旧都在（不覆盖已有）
    expect(新甲[0]?.id).not.toBe('combo-taken')
    expect(新甲[0]?.id).toMatch(/^combo-/)
    expect(combos.find((item) => item.id === 'combo-taken')?.name).toBe('已有')
  })

  it('组合并入不影响工作流模板落库（图结构原样保留）', async () => {
    const store = await makeStore()
    await importWorkflowBundle(store, bundleWithCombos([{ id: 'combo-a', name: '甲', tools: [], mcpServers: [] }]))
    const templates = await store.listFlowTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0]?.name).toBe('组合导入流程')
    const source = makeFlow()
    expect(templates[0]?.nodes.map((node) => node.id)).toEqual(source.nodes.map((node) => node.id))
    expect(templates[0]?.lines.map((line) => `${line.source}->${line.target}`)).toEqual(
      source.lines.map((line) => `${line.source}->${line.target}`),
    )
  })
})

// ---------------------------------------------------------------------------
// IF-12 导出侧的读取失败语义：资源确实为空 ≠ 读取失败
// 旧实现在四处 `.catch(() => [])` 里把「读不到」当成「没有」，导出包因此静默丢失
// 嵌入式资源（用户拿到一个内容缺失但格式合法的包，且没有任何提示）。
// ---------------------------------------------------------------------------

describe('导出侧读取失败不得降级为空资源', () => {
  it('模板目录不可枚举（ENOTDIR）→ 导出上浮错误，不产出缺资源的包', async () => {
    const store = await makeStore()
    await store.saveWorkflow(makeFlow(), 'session-1', { force: true })
    await store.saveTemplate('role', roleTemplate() as never)
    // 目录项被同名文件占位：readdir 抛 ENOTDIR（确定性的非 ENOENT 失败）
    await rm(join(store.root, 'roles'), { recursive: true, force: true })
    await writeFile(join(store.root, 'roles'), 'not a directory')

    await expect(exportWorkflowBundle(store, 'session-1', 'flow-1')).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('工具组合文件损坏 → 导入上浮错误，不按「没有组合」静默并入', async () => {
    const store = await makeStore()
    // combos.json 形状不合法（缺 combos 数组）：读取失败必须上浮，否则重名判重失效
    await writeFile(join(store.root, 'combos.json'), JSON.stringify({ nope: true }))
    const bundle = bundleWithCombos([])

    await expect(importWorkflowBundle(store, bundle)).rejects.toMatchObject({ name: 'InvalidDocumentError' })
  })
})
