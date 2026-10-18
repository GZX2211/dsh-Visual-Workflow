// tests/client/lib/template-to-node.test.ts
//
// 模板 → 画布节点（§4.2.1 深拷贝解耦）：模板字段投影到节点 data。

import { describe, expect, it } from 'vitest'
import { templateToNodeData } from '../../../src/client/lib/template-to-node.js'
import type { RoleTemplate, TaskTemplate, DatabaseTemplate } from '../../../src/host/shared/types.js'

const roleTemplate: RoleTemplate = {
  id: 'r-1', kind: 'agent', name: '研究', systemPrompt: '你是研究员', provider: 'deepseek', model: 'deepseek-chat',
  presetId: 'standard', retryLimit: 3,
}
const taskTemplate: TaskTemplate = { id: 'f-1', name: '任务', content: '任务描述' }
const dbTemplate: DatabaseTemplate = {
  id: 'd-1', name: '知识库', description: '', dbType: 'local', dbKind: 'sqlite', vectorSource: 'embedding',
}

describe('模板 → 节点深拷贝（§4.2.1）', () => {
  it('role 模板 → 节点 data（name→label；presetId 保留）', () => {
    const data = templateToNodeData('role', roleTemplate) as Record<string, unknown>
    expect(data.label).toBe('研究')
    expect(data.systemPrompt).toBe('你是研究员')
    expect(data.presetId).toBe('standard')
    expect(data.groupId).toBeNull()
  })

  it('task 模板 → 节点 data（只投影 label/content，不带文件字段）', () => {
    const data = templateToNodeData('task', taskTemplate)
    expect(data).toEqual({ label: '任务', content: '任务描述' })
    expect(data).not.toHaveProperty('fileKind')
    expect(data).not.toHaveProperty('managedPath')
  })

  it('task 模板无 content：content 落空串（任务描述允许为空）', () => {
    const data = templateToNodeData('task', { id: 't-2', name: '空任务' })
    expect(data).toEqual({ label: '空任务', content: '' })
  })

  it('database 模板 → 节点 data', () => {
    const data = templateToNodeData('database', dbTemplate) as Record<string, unknown>
    expect(data.dbType).toBe('local')
    expect(data.vectorSource).toBe('embedding')
  })
})
