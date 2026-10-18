// tests/host/graph/legacy-nodes.test.ts
//
// 旧图读取兼容：历史数据里的 kind='file' 文件节点在读取时归一化为任务节点。
// 用户裁决：读取兼容 + 保存归一化——content 保留，受管文件字段只读兼容、不再写入。

import { describe, expect, it } from 'vitest'
import { normalizeLegacyNodes } from '../../../src/host/graph/legacy-nodes.js'
import type { GraphNode, TaskNode } from '../../../src/host/shared/graph-model.js'

/** 旧文件节点（历史磁盘形状；受管字段只存在于旧数据中）。 */
function legacyFileNode(id: string, data: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    kind: 'file',
    position: { x: 1, y: 2 },
    data: { label: '需求', fileKind: 'file', content: '正文', ...data },
  } as unknown as GraphNode
}

describe('旧文件节点 → 任务节点（读取兼容）', () => {
  it('保留 label/content，丢弃受管文件字段与旧 kind', () => {
    const nodes = normalizeLegacyNodes([
      legacyFileNode('f1', {
        managedPath: 'data/files/需求.md',
        fileName: '需求.md',
        files: [{ fileName: '需求.md', managedPath: 'data/files/需求.md' }],
      }),
    ])

    expect(nodes).toEqual<TaskNode[]>([{
      id: 'f1',
      kind: 'task',
      position: { x: 1, y: 2 },
      data: { label: '需求', content: '正文' },
    }])
    expect((nodes[0] as unknown as { data: Record<string, unknown> }).data.managedPath).toBeUndefined()
    expect((nodes[0] as unknown as { data: Record<string, unknown> }).data.files).toBeUndefined()
  })

  it('旧节点没有 content：归一化为空串（任务描述允许为空）', () => {
    const [node] = normalizeLegacyNodes([legacyFileNode('f1', { content: undefined, managedPath: 'data/files/a.pdf' })])
    expect(node).toEqual<TaskNode>({
      id: 'f1',
      kind: 'task',
      position: { x: 1, y: 2 },
      data: { label: '需求', content: '' },
    })
  })

  it('非文件节点原样返回（不做形状改写）', () => {
    const agent = {
      id: 'a1',
      kind: 'agent',
      position: { x: 0, y: 0 },
      data: { label: '子代理', systemPrompt: '', provider: '', model: '', retryLimit: 3 },
    } as GraphNode
    const nodes = normalizeLegacyNodes([agent])
    expect(nodes[0]).toBe(agent)
  })

  it('缺失 nodes 返回空数组；非对象项跳过（不把损坏项伪装成节点）', () => {
    expect(normalizeLegacyNodes(undefined)).toEqual([])
    expect(normalizeLegacyNodes(null)).toEqual([])
    const result = normalizeLegacyNodes([null, 'bad', 42, legacyFileNode('f1')] as unknown as GraphNode[])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('f1')
  })
})
