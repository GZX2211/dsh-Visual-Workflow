// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/graph-serialize-convergence.test.tsx
//
// 画布 → 存储投影「唯一本体」门禁（B13-8）：实例（useWorkflows.saveWorkflow）、
// 模板（useFlowTemplates.saveFlowTemplate）、服务（useServiceControl.saveService）
// 三条保存路径发出的落盘形状必须与 lib/graph-serialize.ts 的唯一投影一致，
// 且必须字段保全（不裁剪节点 data、不省略 proxy 空 data、保留 proxySourceId）。
//
// 为什么用 golden 字面量而不是「再算一遍」：断言对象与实现无关，任一路径若自行
// 手写第二份映射（漂移回归），本用例立即变红——这正是收敛要防的「改 3 处漏 1 处」。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { serializeFlow } from '../../../src/client/lib/graph-serialize.js'
import type { CanvasEdge, CanvasNode } from '../../../src/client/lib/canvas-model.js'
import { useWorkflows, type WorkflowsFace } from '../../../src/client/hooks/useWorkflows.js'
import { useFlowTemplates, type FlowTemplatesFace } from '../../../src/client/hooks/useFlowTemplates.js'
import { useServiceControl, type ServiceControlFace } from '../../../src/client/hooks/useServiceControl.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../../src/host/shared/graph-model.js'
import type { ServiceState } from '../../../src/host/shared/types.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

/**
 * 画布夹具：覆盖四种真实漂移面——虚拟节点（data 为空对象）、阶段节点（data 仅 label）、
 * 角色节点（data 携带多字段 + data.kind 历史残留）、协作组节点（memberIds/size），
 * 以及带条件/不带条件两种连线。
 */
const canvasNodes: CanvasNode[] = [
  { id: 'p1', kind: 'proxy', position: { x: 10, y: 20 }, data: {}, proxySourceId: 'n1' },
  { id: 's1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
  { id: 'n1', kind: 'agent', position: { x: 40, y: 0 }, data: { label: '节点一', kind: 'agent', systemPrompt: '', retryLimit: 3 } },
  { id: 'g1', kind: 'group', position: { x: 80, y: 0 }, data: { label: '协作组', collabPrompt: '', memberIds: ['n1'], size: { w: 300, h: 220 } } },
]

const canvasEdges: CanvasEdge[] = [
  { id: 'e1', source: 's1', target: 'n1', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } },
  { id: 'e2', source: 'n1', target: 'p1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
]

/** 收敛前三条生产路径的实际落盘形状（字段保全）：收敛后必须逐字段一致。 */
const goldenNodes = [
  { id: 'p1', kind: 'proxy', position: { x: 10, y: 20 }, data: {}, proxySourceId: 'n1' },
  { id: 's1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
  { id: 'n1', kind: 'agent', position: { x: 40, y: 0 }, data: { label: '节点一', kind: 'agent', systemPrompt: '', retryLimit: 3 } },
  { id: 'g1', kind: 'group', position: { x: 80, y: 0 }, data: { label: '协作组', collabPrompt: '', memberIds: ['n1'], size: { w: 300, h: 220 } } },
]

const goldenLines = [
  { id: 'e1', source: 's1', target: 'n1', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'pass' } },
  { id: 'e2', source: 'n1', target: 'p1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
]

const flow = {
  id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '实例', description: '', revision: 1,
  nodes: [], lines: [], createdAt: '2026-10-11T00:00:00.000Z',
} as unknown as WorkflowDocument

const template = {
  id: 'tpl-1', mode: 'mode1', name: '模板', description: '', revision: 0, nodes: [], lines: [],
} as unknown as WorkflowTemplate

const service = {
  id: 'svc-1', sessionId: 's-1', name: '服务', description: '', revision: 0, nodes: [], lines: [],
  createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', status: 'stopped',
} as unknown as ServiceState

interface Faces {
  workflows: WorkflowsFace
  templates: FlowTemplatesFace
  services: ServiceControlFace
}

/** 渲染三个保存面（同一 dispatch 无关紧要：本用例只观察发出的请求载荷）。 */
async function renderFaces(remote: RemoteFace): Promise<Faces> {
  let faces: Faces | null = null
  function Harness({ onReady }: { onReady: (value: Faces) => void }) {
    const dispatch = vi.fn()
    const workflows = useWorkflows(dispatch, remote)
    const templates = useFlowTemplates(dispatch, remote)
    const services = useServiceControl(dispatch, remote)
    useEffect(() => { onReady({ workflows, templates, services }) }, [workflows, templates, services, onReady])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness, { onReady: (value) => { faces = value } }))
  })
  return faces!
}

/** 记录三条保存路径的请求载荷；远端原样回显文档（等价于后端保存成功）。 */
function makeRemote(): { remote: RemoteFace; calls: Array<{ endpoint: string; args: Record<string, unknown> }> } {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const call = vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
    calls.push({ endpoint, args: args ?? {} })
    if (endpoint === EP.EP_PUT_WORKFLOW) return args?.flow
    if (endpoint === EP.EP_PUT_FLOW_TEMPLATE) return args?.template
    if (endpoint === EP.EP_PUT_SERVICE) return args?.service
    return undefined
  })
  return { remote: { call } as unknown as RemoteFace, calls }
}

describe('画布 → 存储投影：三条保存路径与唯一本体一致（B13-8 收敛门禁）', () => {
  it('实例 / 模板 / 服务落盘形状逐字段等于收敛前的字段保全形状（golden）', async () => {
    const { remote, calls } = makeRemote()
    const faces = await renderFaces(remote)

    await act(async () => {
      await faces.workflows.saveWorkflow(flow, canvasNodes, canvasEdges)
      await faces.templates.saveFlowTemplate(template, canvasNodes, canvasEdges)
      await faces.services.saveService(service, canvasNodes, canvasEdges)
    })

    const payloadOf = (endpoint: string): { nodes: unknown; lines: unknown; key: string } => {
      const hit = calls.find((item) => item.endpoint === endpoint)
      expect(hit, `未发出 ${endpoint}`).toBeDefined()
      const key = endpoint === EP.EP_PUT_WORKFLOW ? 'flow' : endpoint === EP.EP_PUT_FLOW_TEMPLATE ? 'template' : 'service'
      const doc = hit!.args[key] as { nodes: unknown; lines: unknown }
      return { nodes: doc.nodes, lines: doc.lines, key }
    }

    for (const endpoint of [EP.EP_PUT_WORKFLOW, EP.EP_PUT_FLOW_TEMPLATE, EP.EP_PUT_SERVICE]) {
      const { nodes, lines } = payloadOf(endpoint)
      expect(nodes, endpoint).toEqual(goldenNodes)
      expect(lines, endpoint).toEqual(goldenLines)
      // 逐字节一致：落盘 JSON 不允许出现「多余的键被裁掉 / 空 data 被省略 / data.kind 被清理」
      expect(JSON.stringify({ nodes, lines }), endpoint).toBe(JSON.stringify({ nodes: goldenNodes, lines: goldenLines }))
    }
  })

  it('三条保存路径的 nodes/lines 与 lib/graph-serialize 的唯一投影输出相等（防再次内联抄件）', async () => {
    const { remote, calls } = makeRemote()
    const faces = await renderFaces(remote)

    await act(async () => {
      await faces.workflows.saveWorkflow(flow, canvasNodes, canvasEdges)
      await faces.templates.saveFlowTemplate(template, canvasNodes, canvasEdges)
      await faces.services.saveService(service, canvasNodes, canvasEdges)
    })

    const expected = serializeFlow(flow, canvasNodes, canvasEdges)
    const actualOf = (endpoint: string, key: string): { nodes: unknown; lines: unknown } => {
      const hit = calls.find((item) => item.endpoint === endpoint)
      expect(hit, `未发出 ${endpoint}`).toBeDefined()
      const doc = hit!.args[key] as { nodes: unknown; lines: unknown }
      return { nodes: doc.nodes, lines: doc.lines }
    }

    expect(actualOf(EP.EP_PUT_WORKFLOW, 'flow')).toEqual({ nodes: expected.nodes, lines: expected.lines })
    expect(actualOf(EP.EP_PUT_FLOW_TEMPLATE, 'template')).toEqual({ nodes: expected.nodes, lines: expected.lines })
    expect(actualOf(EP.EP_PUT_SERVICE, 'service')).toEqual({ nodes: expected.nodes, lines: expected.lines })
  })
})
