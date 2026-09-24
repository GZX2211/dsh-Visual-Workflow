// tests/client/lib/template-to-node.test.ts
//
// 模板 → 画布节点（§4.2.1 深拷贝解耦）：三类模板映射与字段投影。

import { describe, expect, it } from 'vitest'
import {
  templatesToMaps,
  templateToNodeData,
  templateKindOfNode,
} from '../../../src/client/lib/template-to-node.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate } from '../../../src/host/shared/types.js'

const roleTemplate: RoleTemplate = {
  id: 'r-1', kind: 'agent', name: '研究', systemPrompt: '你是研究员', provider: 'deepseek', model: 'deepseek-chat',
  presetId: 'standard', retryLimit: 3,
}
const fileTemplate: FileTemplate = { id: 'f-1', name: '资料', fileKind: 'text', content: '内容' }
const dbTemplate: DatabaseTemplate = {
  id: 'd-1', name: '知识库', description: '', dbType: 'local', dbKind: 'sqlite', vectorSource: 'embedding',
}

describe('模板 → 节点深拷贝（§4.2.1）', () => {
  it('templatesToMaps：三类映射', () => {
    const maps = templatesToMaps([roleTemplate], [fileTemplate], [dbTemplate])
    expect(maps.role.get('r-1')?.name).toBe('研究')
    expect((maps.file.get('f-1') as FileTemplate).fileKind).toBe('text')
    expect((maps.database.get('d-1') as DatabaseTemplate).dbType).toBe('local')
  })

  it('role 模板 → 节点 data（name→label；presetId 保留）', () => {
    const data = templateToNodeData('role', roleTemplate) as Record<string, unknown>
    expect(data.label).toBe('研究')
    expect(data.systemPrompt).toBe('你是研究员')
    expect(data.presetId).toBe('standard')
    expect(data.groupId).toBeNull()
  })

  it('file 模板 → 节点 data（managedPath 推导 fileName）', () => {
    const data = templateToNodeData('file', { ...fileTemplate, fileKind: 'file', managedPath: 'data/files/a.pdf' }) as Record<string, unknown>
    expect(data.fileKind).toBe('file')
    expect(data.managedPath).toBe('data/files/a.pdf')
    expect(data.fileName).toBe('a.pdf')
  })

  it('file 模板 → 节点 data：多选 files 列表完整传递（需求 §4.2.4.1 可多选所有类型）', () => {
    const data = templateToNodeData('file', {
      ...fileTemplate,
      fileKind: 'file',
      files: [
        { fileName: 'a.pdf', managedPath: 'data/files/a.pdf' },
        { fileName: 'b.docx', managedPath: 'data/files/b.docx' },
      ],
    }) as Record<string, unknown>
    expect(data.files).toEqual([
      { fileName: 'a.pdf', managedPath: 'data/files/a.pdf' },
      { fileName: 'b.docx', managedPath: 'data/files/b.docx' },
    ])
  })

  it('file 模板 → 节点 data：files 为空时节点不带 files 字段（兼容单选旧字段）', () => {
    const data = templateToNodeData('file', { ...fileTemplate, fileKind: 'file', managedPath: 'data/files/a.pdf', files: [] }) as Record<string, unknown>
    expect(data.files).toBeUndefined()
    expect(data.managedPath).toBe('data/files/a.pdf')
  })

  it('database 模板 → 节点 data', () => {
    const data = templateToNodeData('database', dbTemplate) as Record<string, unknown>
    expect(data.dbType).toBe('local')
    expect(data.vectorSource).toBe('embedding')
  })

  it('templateKindOfNode：角色/文件/数据库有模板，其余无', () => {
    expect(templateKindOfNode('agent')).toBe('role')
    expect(templateKindOfNode('parent')).toBe('role')
    expect(templateKindOfNode('file')).toBe('file')
    expect(templateKindOfNode('database')).toBe('database')
    expect(templateKindOfNode('group')).toBeNull()
    expect(templateKindOfNode('proxy')).toBeNull()
  })
})
