// tests/host/transfer/bundle.test.ts
//
// 导入导出领域单测（src/host/transfer/bundle.ts）：v2 bundle 往返、名称冲突策略
// （conflict / rename / overwrite）、嵌入式资源（roles/files/databases/combos）重建、
// embedded.groups 内联语义与稳定领域错误码。
//
// 断言对象是领域行为（bundle 形状与落库结果），不涉及 HTTP 层：领域码 → HTTP 状态
// 的映射在 tests/host/api/routes.test.ts 覆盖。

import { afterEach, describe, expect, it } from 'vitest'
import {
  exportAgentTemplate,
  exportWorkflowBundle,
  importAgentTemplate,
  importWorkflowBundle,
} from '../../../src/host/transfer/bundle.js'
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
    expect(bundle.embedded?.groups).toEqual([{ id: 'g1', name: '协作组一', collabPrompt: '成员互相质询' }])

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
