// tests/host/tools/wf-graph-patch/apply.test.ts
//
// wf_graph_patch 纯函数内核的**虚拟节点 data 归一化**用例
// （原 tests/host/milestone-gate.test.ts 的「补丁层 proxy data 归一化」段，
//   按 tests/AGENTS.md 的镜像规则迁到被测源文件 apply.ts 旁）：
//   - create_node：虚拟节点只保留 label / role 两个字段；
//   - role 越界 → WF_GRAPH_INVALID（错误文本给出取值域）；
//   - update_node_data：提升为闸门 / 清空退回 executor（data 整体删除）；
//   - proxySourceId 顶层字段语义不变；引用不存在的主节点 → 拒绝。
// 角色语义判定（proxyRoleOf 等）与闸门归一化（mainNodeIdOf）见 tests/host/graph/model.test.ts。

import { describe, expect, it } from 'vitest'
import { applyGraphOps, applyGraphOpsTolerant } from '../../../../src/host/tools/wf-graph-patch/apply.js'
import { proxyRoleOf, stageLabel } from '../../../../src/host/graph/index.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
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

function proxyNode(id: string, sourceId: string, data?: { label?: string; role?: 'executor' | 'milestone' }): GraphNode {
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

/** 含闸门的最小合法图：start → m1(→p1) → a1 → end。 */
function gateFlow(role?: 'executor' | 'milestone'): WorkflowDocument {
  return {
    id: 'wf-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '闸门流程',
    description: '',
    revision: 1,
    nodes: [stage('s', 'start'), parentNode('p1', 'CEO'), proxyNode('m1', 'p1', role ? { role } : undefined), agentNode('a1'), stage('e', 'end')],
    lines: [flowLine('l1', 's', 'm1'), flowLine('l2', 'm1', 'a1'), flowLine('l3', 'a1', 'e')],
  }
}

describe('file 节点：写图只产文本型（D-07）', () => {
  /** 取节点 data：结果文档的 nodes 是 unknown[]，测试内收窄一次。 */
  function dataOf(doc: { nodes: unknown[] }, id: string): Record<string, unknown> {
    const found = (doc.nodes as Array<{ id: string; data: Record<string, unknown> }>).find((node) => node.id === id)
    if (!found) throw new Error(`测试夹具缺少节点：${id}`)
    return found.data
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
  it('create_node：虚拟节点的 label / role 落盘（只保留这两个字段）', () => {
    const doc = gateFlow('milestone')
    const { doc: next } = applyGraphOps({
      doc,
      ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { label: '里程碑②', role: 'milestone', junk: 1 } } }],
    })
    const created = (next.nodes as GraphNode[]).find((n) => n.id === 'm2') as { data?: Record<string, unknown> }
    expect(created.data).toEqual({ label: '里程碑②', role: 'milestone' })
  })

  it('create_node：role 越界 → WF_GRAPH_INVALID（错误文本给出取值域）', () => {
    const doc = gateFlow('milestone')
    expect(() => applyGraphOps({ doc, ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { role: 'gate' } } }] }))
      .toThrowError(/executor|milestone/)
    try {
      applyGraphOps({ doc, ops: [{ op: 'create_node', node: { id: 'm2', kind: 'proxy', proxySourceId: 'p1', data: { role: 'gate' } } }] })
    } catch (error) {
      expect((error as WfError).code).toBe('WF_GRAPH_INVALID')
    }
  })

  it('update_node_data：可把普通虚拟节点提升为闸门（并支持清空 role 退回 executor）', () => {
    const doc = gateFlow('executor')
    const up = applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { role: 'milestone', label: '闸门' } }] })
    const upNodes = up.doc.nodes as GraphNode[]
    expect(proxyRoleOf(upNodes.find((n) => n.id === 'm1'))).toBe('milestone')
    // 清空 role / label → data 整体删除，退回缺省 executor
    const down = applyGraphOps({ doc: up.doc as unknown as WorkflowDocument, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { role: null, label: '' } }] })
    const downNodes = down.doc.nodes as GraphNode[]
    const node = downNodes.find((n) => n.id === 'm1') as { data?: unknown }
    expect(node.data).toBeUndefined()
    expect(proxyRoleOf(downNodes.find((n) => n.id === 'm1'))).toBe('executor')
  })

  it('update_node_data：虚拟节点仍可改引用主节点（回归：proxySourceId 顶层字段语义不变）', () => {
    const doc = gateFlow('milestone')
    const up = applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: 'a1' } }] })
    expect((((up.doc.nodes as GraphNode[]).find((n) => n.id === 'm1')) as { proxySourceId?: string }).proxySourceId).toBe('a1')
  })

  it('update_node_data：引用不存在的主节点 → 拒绝（既有校验保留）', () => {
    const doc = gateFlow('milestone')
    expect(() => applyGraphOps({ doc, ops: [{ op: 'update_node_data', nodeId: 'm1', data: { proxySourceId: '不存在' } }] }))
      .toThrowError(/必须引用已存在的角色节点/)
  })
})

// ---------------------------------------------------------------------------
// 角色节点 data 补全（apply.ts 的 normalizeRoleNodeData）
// ---------------------------------------------------------------------------
// 为什么归到这里：原 graph/validate.ts 的 normalizeFlow 也做「角色节点补默认值」，
// 但它从未被生产代码调用且实现为字段白名单重写（会丢 meta/lastPatch 与未来新增字段），
// 2026.10 治理中已删除。真正生效的补全入口是本模块的 normalizeRoleNodeData（父代理
// 经 wf_graph_patch 建/改节点时的唯一规范化点），故其补全语义的断言收敛于此。
// 另一条硬护栏同在 apply.ts：五个画布所有的字段（retryLimit / reactLimit / promptFilePath /
// injectSystemPrompt / injectToolSections）对父代理不可配置——创建时剥离传入值并写系统
// 默认，更新时剥离传入值并保留现值。

describe('角色节点 data 补全（normalizeRoleNodeData）', () => {
  // 入参用严格契约 WorkflowDocument（applyGraphOps 输入类型）；出参 doc 是宽松的
  // GraphPatchResult.doc 形状，故断言后用 roleDataOf 读取节点 data。
  type PatchDoc = ReturnType<typeof applyGraphOps>['doc']
  const roleDataOf = (doc: PatchDoc, id: string): Record<string, unknown> => {
    const node = (doc.nodes as GraphNode[]).find((n) => n.id === id)
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
    expect(data.outputSchema).toBe('')
    expect(data.groupId).toBeNull()
    // 官方系统提示词段与工具散文段固定关闭：父代理不可配置（画布属性栏所有）
    expect(data.injectSystemPrompt).toBe(false)
    expect(data.injectToolSections).toBe(false)
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
        // group 已存在 → create_group 抛错；随后的 set_group_members 仍应看到原组成员
        { op: 'create_group', groupId: 'a1', label: 'x' },
        { op: 'set_group_members', groupId: 'g1', memberIds: ['a1'] },
      ],
    })
    expect(errors.map((item) => item.index)).toEqual([0, 1])
  })

  it('非 WfError 直接抛出，不被收集（工具缺陷不得伪装成「某条 op 写错了」）', () => {
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
