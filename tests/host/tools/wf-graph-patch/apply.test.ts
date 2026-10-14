// tests/host/tools/wf-graph-patch/apply.test.ts
//
// wf_graph_patch 纯函数内核的**虚拟节点 data 归一化**用例
//   - create_node：虚拟节点只保留 label 一个字段（未知字段静默丢弃）；
//   - update_node_data：清空 label → data 整体删除；
//   - proxySourceId 顶层字段语义不变；引用不存在的主节点 → 拒绝。

import { describe, expect, it, vi } from 'vitest'
import { applyGraphOps, applyGraphOpsTolerant } from '../../../../src/host/tools/wf-graph-patch/apply.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../../src/host/shared/protocol.js'
import type { GraphPatchOp } from '../../../../src/host/tools/wf-graph-patch/types.js'
import type { GraphNode, Line, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'

// ---------------------------------------------------------------------------
// 图构造
// ---------------------------------------------------------------------------

function stage(id: string, kind: 'start' | 'end'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

function agentNode(id: string, label = id): GraphNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: { label, systemPrompt: '', provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
  }
}

function parentNode(id: string, label = id): GraphNode {
  return {
    id,
    kind: 'parent',
    position: { x: 0, y: 0 },
    data: { label, systemPrompt: '', provider: '', model: '', presetId: null, retryLimit: 3, reactLimit: null, inputSchema: '', outputSchema: '', groupId: null },
  }
}

function proxyNode(id: string, sourceId: string, data?: { label?: string }): GraphNode {
  return { id, kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: sourceId, ...(data ? { data } : {}) }
}

function flowLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

/** 最小文档壳：只关心节点集，连线由用例自行补齐。 */
function flowOf(nodes: GraphNode[]): WorkflowDocument {
  return {
    id: 'wf-1', sessionId: 'session-1', mode: 'mode1', name: 'x', description: '', revision: 1,
    nodes, lines: [],
  }
}

/** 文本型文件节点。 */
function fileNode(id: string, label = id): GraphNode {
  return { id, kind: 'file', position: { x: 0, y: 0 }, data: { label, fileKind: 'text', content: '' } }
}

/** 既有受管文件节点（画布手工拖入的形态：带受管副本路径）。 */
function managedFileNode(id: string, label = id): GraphNode {
  return {
    id,
    kind: 'file',
    position: { x: 0, y: 0 },
    data: {
      label,
      fileKind: 'file',
      managedPath: 'data/files/旧件.md',
      fileName: '旧件.md',
      files: [{ fileName: '旧件.md', managedPath: 'data/files/旧件.md' }],
    },
  }
}

/** 最小含虚拟节点的合法图：start → m1(→p1) → a1 → end。 */
function proxyFlow(): WorkflowDocument {
  return {
    id: 'wf-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '虚拟节点流程',
    description: '',
    revision: 1,
    nodes: [stage('s', 'start'), parentNode('p1', 'CEO'), proxyNode('m1', 'p1'), agentNode('a1'), stage('e', 'end')],
    lines: [flowLine('l1', 's', 'm1'), flowLine('l2', 'm1', 'a1'), flowLine('l3', 'a1', 'e')],
  }
}

describe('file 节点：写图只产文本型（D-07）', () => {
  /** 取节点 data：结果文档的 nodes 是真实节点联合，只在此收窄到 data 一层。 */
  function dataOf(doc: { nodes: GraphNode[] }, id: string): Record<string, unknown> {
    const found = doc.nodes.find((node) => node.id === id)
    if (!found) throw new Error(`测试夹具缺少节点：${id}`)
    return found.data as Record<string, unknown>
  }

  it('test_create_node 传受管文件_归一化为文本型并报告归一化', () => {
    const doc = flowOf([stage('s', 'start'), stage('e', 'end')])

    const result = applyGraphOps({
      doc,
      ops: [{
        op: 'create_node',
        node: {
          kind: 'file',
          id: 'f1',
          data: {
            label: '交付文件',
            fileKind: 'file',
            managedPath: 'data/files/x.md',
            files: [{ fileName: 'x.md', managedPath: 'data/files/x.md' }],
          },
        },
      }],
    })

    expect(dataOf(result.doc, 'f1')).toMatchObject({ fileKind: 'text', label: '交付文件' })
    expect(dataOf(result.doc, 'f1').managedPath).toBeUndefined()
    expect(dataOf(result.doc, 'f1').files).toBeUndefined()
    expect(result.fileNodeTextOnlyIds).toEqual(['f1'])
  })

  it('test_create_node 传文本型_不报告归一化', () => {
    const doc = flowOf([stage('s', 'start'), stage('e', 'end')])

    const result = applyGraphOps({
      doc,
      ops: [{ op: 'create_node', node: { kind: 'file', id: 'f2', data: { label: '任务书', fileKind: 'text', content: '正文' } } }],
    })

    expect(dataOf(result.doc, 'f2')).toMatchObject({ label: '任务书', fileKind: 'text', content: '正文' })
    expect(result.fileNodeTextOnlyIds).toEqual([])
  })

  it('test_update_node_data 显式要求受管_归一化为文本型并报告', () => {
    const doc = flowOf([stage('s', 'start'), fileNode('f1'), stage('e', 'end')])

    const result = applyGraphOps({
      doc,
      ops: [{ op: 'update_node_data', nodeId: 'f1', data: { fileKind: 'file', managedPath: 'data/files/x.md' } }],
    })

    expect(dataOf(result.doc, 'f1')).toMatchObject({ fileKind: 'text' })
    expect(dataOf(result.doc, 'f1').managedPath).toBeUndefined()
    expect(result.fileNodeTextOnlyIds).toEqual(['f1'])
  })

  it('test_update_node_data 仅改名称_保留既有受管配置', () => {
    const doc = flowOf([stage('s', 'start'), managedFileNode('f1'), stage('e', 'end')])

    const result = applyGraphOps({
      doc,
      ops: [{ op: 'update_node_data', nodeId: 'f1', data: { label: '改名' } }],
    })

    expect(dataOf(result.doc, 'f1')).toMatchObject({ label: '改名', fileKind: 'file', managedPath: 'data/files/旧件.md' })
    expect(result.fileNodeTextOnlyIds).toEqual([])
  })
})

describe('补丁层 proxy data 归一化（applyGraphOps 纯函数）', () => {
  it('create_node：虚拟节点只保留 label（role 等未知字段静默丢弃）', () => {
    const doc = proxyFlow()
    const { doc: next } = applyGraphOps({
      doc,
      ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { label: '复核点', role: 'milestone', junk: 1 } } }],
    })
    const created = (next.nodes as GraphNode[]).find((n) => n.id === 'm2') as { data?: Record<string, unknown> }
    expect(created.data).toEqual({ label: '复核点' })
  })

  it('update_node_data：清空 label → data 整体删除（保持文档形状最小）', () => {
    const doc = proxyFlow()
    const up = applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { label: '复核点' } }] })
    const upNode = up.doc.nodes.find((n) => n.id === 'm1') as { data?: unknown }
    expect(upNode.data).toEqual({ label: '复核点' })
    const down = applyGraphOps({ doc: up.doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { label: '' } }] })
    const downNode = down.doc.nodes.find((n) => n.id === 'm1') as { data?: unknown }
    expect(downNode.data).toBeUndefined()
  })

  it('update_node_data：虚拟节点仍可改引用主节点（回归：proxySourceId 顶层字段语义不变）', () => {
    const doc = proxyFlow()
    const up = applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: 'a1' } }] })
    expect((((up.doc.nodes as GraphNode[]).find((n) => n.id === 'm1')) as { proxySourceId?: string }).proxySourceId).toBe('a1')
  })

  it('update_node_data：引用不存在的主节点 → 拒绝（既有校验保留）', () => {
    const doc = proxyFlow()
    expect(() => applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: '不存在' } }] }))
      .toThrowError(/must reference an existing role node/)
  })
})

// ---------------------------------------------------------------------------
// 角色节点 data 补全（apply.ts 的 normalizeRoleNodeData）
// ---------------------------------------------------------------------------
// 为什么归到这里：原 graph/validate.ts 的 normalizeFlow 也做"角色节点补默认值"，
// 但它从未被生产代码调用且实现为字段白名单重写（会丢 meta/lastPatch 与未来新增字段），
// 2026.10 治理中已删除。真正生效的补全入口是本模块的 normalizeRoleNodeData（父代理
// 经 wf_graph_patch 建/改节点时的唯一规范化点），故其补全语义的断言收敛于此。
// 另一条硬护栏同在 apply.ts：五个画布所有的字段（retryLimit / reactLimit / promptFilePath /
// injectSystemPrompt / injectToolSections）对父代理不可配置——创建时剥离传入值并写系统
// 默认，更新时剥离传入值并保留现值。

describe('角色节点 data 补全（normalizeRoleNodeData）', () => {
  // 出参 doc 直接复用图契约本体（GraphPatchResult.doc = WorkflowDocument），
  // 故断言只按节点判别联合收窄到 data 即可，无需再对文档本身做双重断言。
  type PatchDoc = ReturnType<typeof applyGraphOps>['doc']
  const roleDataOf = (doc: PatchDoc, id: string): Record<string, unknown> => {
    const node = doc.nodes.find((n) => n.id === id)
    return (node as unknown as { data: Record<string, unknown> }).data
  }

  it('create_node：模型只给 label/systemPrompt 时补全运行必需字段（注入开关固定关闭）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{ op: 'create_node', node: { id: 'a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: '评审', systemPrompt: '你是评审' } } }],
    })
    const data = roleDataOf(doc, 'a1')
    expect(data.label).toBe('评审')
    expect(data.systemPrompt).toBe('你是评审')
    expect(data.presetId).toBeNull() // 空 = 运行期零工具集（工具描述已写明契约）
    expect(data.retryLimit).toBe(3)
    expect(data.reactLimit).toBeNull()
    expect(data.provider).toBe('')
    expect(data.model).toBe('')
    expect(data.inputSchema).toBe('')
    // 输出契约默认文本随创建落盘（与画布新建 newRoleNode 一致：界面显示即实际注入的内容）
    expect(data.outputSchema).toBe(DEFAULT_OUTPUT_CONTRACT_TEXT)
    expect(data.groupId).toBeNull()
    // 官方系统提示词段与工具散文段固定关闭：父代理不可配置（画布属性栏所有）
    expect(data.injectSystemPrompt).toBe(false)
    expect(data.injectToolSections).toBe(false)
  })

  it('create_node：父代理节点不落默认输出契约（父代理不参与节点交接）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{ op: 'create_node', node: { id: 'p1', kind: 'parent', position: { x: 0, y: 0 }, data: { label: '父代理' } } }],
    })
    expect(roleDataOf(doc, 'p1').outputSchema).toBe('')
  })

  it('create_node：显式传入空串 = 明确清空，不落默认契约', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{ op: 'create_node', node: { id: 'a1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'L', outputSchema: '' } } }],
    })
    expect(roleDataOf(doc, 'a1').outputSchema).toBe('')
  })

  it('create_node：可配置字段原样保留（空串 / 显式值不被归一覆盖）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{
        op: 'create_node',
        node: {
          id: 'a1', kind: 'agent', position: { x: 0, y: 0 },
          data: { label: 'L', systemPrompt: '', provider: '', model: '', presetId: 'combo-x', reasoning: 'high', inputSchema: 'in' },
        },
      }],
    })
    const data = roleDataOf(doc, 'a1')
    expect(data.presetId).toBe('combo-x')
    expect(data.reasoning).toBe('high')
    expect(data.inputSchema).toBe('in')
    expect(data.provider).toBe('')
    expect(data.model).toBe('')
  })

  it('create_node：父代理传入的五个不可配置字段被剥离，一律写系统默认', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start')]),
      ops: [{
        op: 'create_node',
        node: {
          id: 'a1', kind: 'agent', position: { x: 0, y: 0 },
          data: {
            label: 'L', systemPrompt: 'P',
            retryLimit: 9, reactLimit: 5, promptFilePath: 'D:/role.md',
            injectSystemPrompt: true, injectToolSections: true,
          },
        },
      }],
    })
    const data = roleDataOf(doc, 'a1')
    expect(data.retryLimit).toBe(3)
    expect(data.reactLimit).toBeNull()
    expect(data.injectSystemPrompt).toBe(false)
    expect(data.injectToolSections).toBe(false)
    expect('promptFilePath' in data).toBe(false)
  })

  it('update_node_data：父代理传入的五个不可配置字段被剥离，保留节点现值（用户手动改过的值不被覆盖）', () => {
    const manual: GraphNode = {
      id: 'a1',
      kind: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'a1', systemPrompt: '', provider: '', model: '', presetId: null,
        retryLimit: 7, reactLimit: 11, inputSchema: '', outputSchema: '', groupId: null,
        promptFilePath: 'D:/role.md', injectSystemPrompt: true, injectToolSections: true,
      },
    }
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start'), manual]),
      ops: [{
        op: 'update_node_data',
        nodeId: 'a1',
        data: {
          label: '改后的名字',
          retryLimit: 1, reactLimit: 2, promptFilePath: 'D:/other.md',
          injectSystemPrompt: false, injectToolSections: false,
        },
      }],
    })
    const data = roleDataOf(doc, 'a1')
    expect(data.label).toBe('改后的名字') // 可配置字段正常更新
    expect(data.retryLimit).toBe(7) // 保留用户手动值
    expect(data.reactLimit).toBe(11)
    expect(data.promptFilePath).toBe('D:/role.md')
    expect(data.injectSystemPrompt).toBe(true)
    expect(data.injectToolSections).toBe(true)
  })

  it('update_node_data：补全不剥离未知字段（systemPromptSource 等展示字段保留）', () => {
    const { doc } = applyGraphOps({
      doc: flowOf([stage('s', 'start'), agentNode('a1')]),
      ops: [{ op: 'update_node_data', nodeId: 'a1', data: { label: '改', systemPromptSource: '角色说明.md' } }],
    })
    expect(roleDataOf(doc, 'a1').systemPromptSource).toBe('角色说明.md')
  })
})

// ---------------------------------------------------------------------------
// 容错应用（applyGraphOpsTolerant）：失败项收集 + 成功项继续
// ---------------------------------------------------------------------------

describe('容错应用（applyGraphOpsTolerant）', () => {
  it('失败的 op 记入 errors 并跳过，其余 op 正常生效且 id 清单合并', () => {
    const { result, errors } = applyGraphOpsTolerant({
      doc: flowOf([stage('s', 'start'), agentNode('a1')]),
      ops: [
        { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } },
        { op: 'connect', source: 'a1', target: '不存在' },
        { op: 'create_node', node: { id: 'a3', kind: 'agent', data: { label: '复核' } } },
      ],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ index: 1, op: 'connect', code: 'WF_GRAPH_INVALID' })
    expect(result.createdNodeIds).toEqual(['a2', 'a3'])
    expect((result.doc.nodes as GraphNode[]).map((node) => node.id)).toContain('a3')
  })

  it('失败项不污染后续判定：抛错的 op 不留下任何中间状态', () => {
    const { errors } = applyGraphOpsTolerant({
      doc: flowOf([stage('s', 'start'), agentNode('a1')]),
      ops: [
        // group already exists → create_group 抛错；随后的 set_group_members 仍应看到原组成员
        { op: 'create_group', groupId: 'a1', label: 'x' },
        { op: 'set_group_members', groupId: 'g1', memberIds: ['a1'] },
      ],
    })
    expect(errors.map((item) => item.index)).toEqual([0, 1])
  })

  it('非 WfError 直接抛出，不被收集（工具缺陷不得伪装成"某条 op 写错了"）', () => {
    const broken = { get op(): string { throw new TypeError('内部缺陷') } }
    expect(() => applyGraphOpsTolerant({
      doc: flowOf([stage('s', 'start')]),
      ops: [broken as never],
    })).toThrow(TypeError)
  })

  it('全部成功时：结果与严格应用器语义一致（仅随机生成的连线 id 不同）', () => {
    const doc = flowOf([stage('s', 'start'), agentNode('a1')])
    const ops = [
      { op: 'create_node' as const, node: { id: 'a2', kind: 'agent', data: { label: '分析' } } },
      { op: 'connect' as const, source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ]
    const tolerant = applyGraphOpsTolerant({ doc, ops })
    const strict = applyGraphOps({ doc, ops })
    const nodeIds = (value: typeof strict) => (value.doc.nodes as GraphNode[]).map((node) => node.id)
    const lineShapes = (value: typeof strict) => (value.doc.lines as Line[]).map((line) => `${line.source}>${line.sourceHandle}->${line.target}`)
    expect(tolerant.errors).toEqual([])
    expect(nodeIds(tolerant.result)).toEqual(nodeIds(strict))
    expect(lineShapes(tolerant.result)).toEqual(lineShapes(strict))
    expect(tolerant.result.createdNodeIds).toEqual(strict.createdNodeIds)
    expect(tolerant.result.connectedLineIds).toHaveLength(strict.connectedLineIds.length)
  })
})

// ---------------------------------------------------------------------------
// 容错应用 · 单份副本就地应用（D03-13）
// ---------------------------------------------------------------------------
// 旧实现把每条 op 单独交给严格应用器，而严格应用器每次都对整图 JSON 深拷贝：
// N 条 op = N 次全图往返。以下用例锁定「一次深拷贝 + 逐条就地」后的两个不变量：
//   1) 全图深拷贝次数与 op 数无关；
//   2) 结果的图内容与「逐条严格应用」（旧实现）逐字节等价——性能优化不得改变语义，
//      尤其不得让失败的 op 污染后续 op 的判定基础。

/** 旧实现的等价参照：逐条交给严格应用器（每条 op 各深拷贝一次全图），失败即跳过。 */
function strictPerOp(doc: WorkflowDocument, ops: GraphPatchOp[]): {
  doc: WorkflowDocument
  errors: Array<{ index: number; op: string; code: string; message: string }>
  createdNodeIds: string[]
  removedNodeIds: string[]
  updatedNodeIds: string[]
  connectedLineIds: string[]
  disconnectedLineIds: string[]
  fileNodeTextOnlyIds: string[]
} {
  let current = doc
  const errors: Array<{ index: number; op: string; code: string; message: string }> = []
  const ids = {
    createdNodeIds: [] as string[],
    removedNodeIds: [] as string[],
    updatedNodeIds: [] as string[],
    connectedLineIds: [] as string[],
    disconnectedLineIds: [] as string[],
    fileNodeTextOnlyIds: [] as string[],
  }
  ops.forEach((op, index) => {
    try {
      const applied = applyGraphOps({ doc: current, ops: [op] })
      current = applied.doc
      ids.createdNodeIds.push(...applied.createdNodeIds)
      ids.removedNodeIds.push(...applied.removedNodeIds)
      ids.updatedNodeIds.push(...applied.updatedNodeIds)
      ids.connectedLineIds.push(...applied.connectedLineIds)
      ids.disconnectedLineIds.push(...applied.disconnectedLineIds)
      ids.fileNodeTextOnlyIds.push(...applied.fileNodeTextOnlyIds)
    } catch (error) {
      if (!(error instanceof WfError)) throw error
      errors.push({
        index,
        op: String((op as { op?: unknown }).op ?? ''),
        code: String(error.code ?? ''),
        message: error.message,
      })
    }
  })
  return { doc: current, errors, ...ids }
}

/** 规范化 JSON：连线 id 由 makeLineId() 随机生成，比较前统一替换为序号（其余逐字节比较）。 */
function canonicalDoc(doc: WorkflowDocument): string {
  const copy = JSON.parse(JSON.stringify(doc)) as WorkflowDocument
  copy.lines = copy.lines.map((line, index) => ({ ...line, id: `line-${index}` }))
  return JSON.stringify(copy)
}

/** 成功与失败交错的混合批次（覆盖七种 op、级联删除、file 归一化与组一致性）。 */
function mixedOps(): GraphPatchOp[] {
  return [
    { op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } },
    { op: 'connect', source: 'a1', target: 'a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { op: 'connect', source: 'a2', target: '不存在' },
    { op: 'update_node_data', nodeId: 'a2', data: { label: '分析②' } },
    { op: 'create_node', node: { id: 'f1', kind: 'file', data: { label: '交付', fileKind: 'file', managedPath: 'data/files/x.md' } } },
    { op: 'create_group', groupId: 'g1', label: '协作组', memberIds: ['a1'] },
    { op: 'set_group_members', groupId: 'g1', memberIds: ['a1', 'a2'] },
    { op: 'create_group', groupId: 'g2', label: '坏组', memberIds: ['不存在'] },
    { op: 'set_group_members', groupId: 'g2', memberIds: ['a1'] },
    { op: 'disconnect', lineId: 'l3' },
    { op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: '缺失' } },
    { op: 'create_node', node: { id: 'a1', kind: 'agent', data: {} } },
    { op: 'update_node_data', nodeId: '缺失', data: { label: 'x' } },
    { op: 'remove_node', nodeId: 'a2' },
    { op: 'set_group_members', groupId: '', memberIds: [] },
  ]
}

describe('容错应用 · 单份副本就地应用（D03-13）', () => {
  /** 只统计「整图 JSON 深拷贝」：cloneDoc 对 nodes / lines 各调一次 JSON.stringify。 */
  function docCopyCount(ops: GraphPatchOp[]): number {
    const spy = vi.spyOn(JSON, 'stringify')
    try {
      applyGraphOpsTolerant({ doc: flowOf([stage('s', 'start'), agentNode('a1')]), ops })
      return spy.mock.calls.filter((call) => Array.isArray(call[0])).length
    } finally {
      spy.mockRestore()
    }
  }

  function createOps(count: number): GraphPatchOp[] {
    return Array.from({ length: count }, (_, index) => ({
      op: 'create_node' as const,
      node: { id: `n${index}`, kind: 'agent', data: { label: `节点${index}` } },
    }))
  }

  it('全图深拷贝次数与 op 数无关（N 条 op 只深拷贝一次，而非 N 次）', () => {
    // 判别点：旧实现为 2N（nodes / lines 各一次/op）——10 条时 20、40 条时 80。
    // 断言「不随 N 增长」，而不是绑定某个内部计数实现。
    expect(docCopyCount(createOps(10))).toBe(2)
    expect(docCopyCount(createOps(40))).toBe(2)
  })

  it('混合批次（成功 + 失败）：结果与「逐条严格应用」逐字节等价', () => {
    const doc = proxyFlow()
    const ops = mixedOps()

    const tolerant = applyGraphOpsTolerant({ doc, ops })
    const reference = strictPerOp(doc, ops)

    expect(tolerant.errors).toEqual(reference.errors)
    expect(canonicalDoc(tolerant.result.doc)).toBe(canonicalDoc(reference.doc))
    expect(tolerant.result.createdNodeIds).toEqual(reference.createdNodeIds)
    expect(tolerant.result.removedNodeIds).toEqual(reference.removedNodeIds)
    expect(tolerant.result.updatedNodeIds).toEqual(reference.updatedNodeIds)
    expect(tolerant.result.connectedLineIds).toHaveLength(reference.connectedLineIds.length)
    expect(tolerant.result.disconnectedLineIds).toEqual(reference.disconnectedLineIds)
    // 新增连线的 id 由 makeLineId() 随机生成，无法跨两次运行逐字节比较；这里只锁定
    // 「数量一致且互不重复」——连线的内容等价已由上面的文档逐字节比较覆盖。
    expect(new Set(tolerant.result.connectedLineIds).size).toBe(tolerant.result.connectedLineIds.length)
    expect(tolerant.result.fileNodeTextOnlyIds).toEqual(reference.fileNodeTextOnlyIds)
    // 失败项下标锁定：3 条 connect/引用类、2 条因 g2 未创建的组类、1 条入参类
    expect(tolerant.errors.map((item) => item.index)).toEqual([2, 7, 8, 10, 11, 12, 14])
    expect(tolerant.result.fileNodeTextOnlyIds).toEqual(['f1'])
  })

  it('失败 op 不留半成品：成员校验失败后组不存在，后续针对该组的 op 仍失败', () => {
    const { result, errors } = applyGraphOpsTolerant({
      doc: proxyFlow(),
      ops: [
        { op: 'create_group', groupId: 'g2', label: '坏组', memberIds: ['不存在'] },
        { op: 'set_group_members', groupId: 'g2', memberIds: ['a1'] },
      ],
    })
    // 就地路径没有「整份副本可丢弃」这层保护：隔离只能由「先校验后改动」保证，
    // 因此第二条 op 必须仍看不到 g2（旧实现与新实现都如此）。
    expect(errors.map((item) => item.index)).toEqual([0, 1])
    expect(result.doc.nodes.some((node) => node.id === 'g2')).toBe(false)
  })

  it('失败 op 不留半成品：引用非法时，同一 op 的其它字段保持原值', () => {
    const { result, errors } = applyGraphOpsTolerant({
      doc: proxyFlow(),
      ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: '不存在', label: '改名' } }],
    })
    expect(errors).toHaveLength(1)
    // 引用校验在改动前抛错；此时 label 不得已经被改掉
    const m1 = result.doc.nodes.find((node) => node.id === 'm1') as { proxySourceId?: string; data?: { label?: string } }
    expect(m1.proxySourceId).toBe('p1')
    expect(m1.data).toBeUndefined()
  })

  it('严格应用器不改写入参（一次拷贝语义不变）', () => {
    const doc = proxyFlow()
    const before = JSON.stringify(doc)
    applyGraphOps({ doc, ops: [{ op: 'create_node', node: { id: 'a2', kind: 'agent', data: { label: '分析' } } }] })
    expect(JSON.stringify(doc)).toBe(before)
  })
})
