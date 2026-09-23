// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useWorkflows.test.tsx
//
// useWorkflows（hooks/useWorkflows.ts）单测：
//   ① Bug 清单 P1 回归：saveWorkflow 的在途去重必须按 flowId 区分——保存工作流 A
//      未完成时切换到工作流 B 保存，B 必须独立持久化（修复前会复用 A 的在途
//      Promise，B 内容丢失：「保存成功」但实际没保存）；
//   ② Bug 2 回归：serializeWorkflow（画布 → 文档序列化）必须保留虚拟节点顶层
//      proxySourceId（否则保存后后端 validateFlow 报 proxySourceMissing，虚拟节点全链路不可用）。
//
// 注（治理）：本文件原为 tests/client/serialize-workflow.test.ts，结构治理后按源文件
// 归属拆分——其中 serializeWorkflow 用例归入本文件，serializeFlow 用例归入
// tests/client/lib/graph-model.test.ts（两者由不同源模块导出）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { serializeWorkflow, useWorkflows, type WorkflowsFace } from '../../../src/client/hooks/useWorkflows.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'

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

function makeFlow(id: string, name: string): WorkflowDocument {
  return {
    id,
    sessionId: 's-1',
    mode: 'mode1',
    name,
    description: '',
    revision: 1,
    nodes: [],
    lines: [],
    createdAt: '2026-08-25T00:00:00.000Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 渲染 useWorkflows，暴露 face 供测试操作。 */
async function renderFace(remote: RemoteFace): Promise<WorkflowsFace> {
  let face: WorkflowsFace | null = null
  function Harness({ onReady }: { onReady: (f: WorkflowsFace) => void }) {
    const f = useWorkflows(vi.fn(), remote)
    useEffect(() => { onReady(f) }, [f, onReady])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness, { onReady: (f) => { face = f } }))
  })
  return face!
}

describe('useWorkflows.saveWorkflow 并发去重（Bug 清单 P1）', () => {
  it('切换工作流后保存独立发出，不复用前一在途保存', async () => {
    const dA = deferred<WorkflowDocument>()
    const call = vi.fn((endpoint: string, args: { flow: WorkflowDocument }) => {
      if (args.flow.id === 'flow-a') return dA.promise
      return Promise.resolve({ ...args.flow, revision: 2 })
    })
    const remote = { call } as unknown as RemoteFace
    const face = await renderFace(remote)
    const flowA = makeFlow('flow-a', '工作流A')
    const flowB = makeFlow('flow-b', '工作流B')

    let savedB: Promise<WorkflowDocument | null> | null = null
    // A 保存挂起（remote 未返回）；随后用户切换到 B 并保存：必须发起独立的
    // PUT（修复前复用 A 的 Promise → B 丢失）。saveWorkflow 不触达 React 状态
    // （dispatch 为 vi.fn），无需 act 包裹。
    void face.saveWorkflow(flowA, [], [])
    savedB = face.saveWorkflow(flowB, [], [])
    await Promise.resolve()

    // 两个工作流各自持久化一次
    const putCalls = call.mock.calls.filter(([ep]) => ep === EP.EP_PUT_WORKFLOW)
    expect(putCalls).toHaveLength(2)
    expect(putCalls.map(([, args]) => (args as { flow: WorkflowDocument }).flow.id)).toEqual(['flow-a', 'flow-b'])

    // A 完成后 B 的结果独立返回（不为 null、id 为 flow-b）
    await act(async () => {
      dA.resolve({ ...flowA, revision: 2 })
      await Promise.resolve()
    })
    expect((await savedB!)?.id).toBe('flow-b')
  })

  it('同一工作流的重复保存：在途期间只一次 PUT，待首存返回后用最新内容补发一次', async () => {
    const dA = deferred<WorkflowDocument>()
    let putCount = 0
    const call = vi.fn(async (endpoint: string, args: { flow: WorkflowDocument }) => {
      putCount += 1
      if (putCount === 1) return dA.promise
      return { ...args.flow, revision: 3 }
    })
    const remote = { call } as unknown as RemoteFace
    const face = await renderFace(remote)
    const flowA = makeFlow('flow-a', '工作流A')

    let p1: Promise<WorkflowDocument | null> | null = null
    let p2: Promise<WorkflowDocument | null> | null = null
    // 同一工作流的两次保存：第二次**不得**只复用同一结果——它的新内容
    //（这里用新坐标区分）必须落库。在途期间只发出一次 PUT。
    p1 = face.saveWorkflow(flowA, [], [])
    p2 = face.saveWorkflow(flowA, [{ id: 'n1', kind: 'agent', position: { x: 7, y: 9 }, data: {} }] as never, [])
    await Promise.resolve()
    expect(call.mock.calls.filter(([ep]) => ep === EP.EP_PUT_WORKFLOW)).toHaveLength(1)

    await act(async () => {
      dA.resolve({ ...flowA, revision: 2 })
      await Promise.all([p1, p2])
    })

    const puts = call.mock.calls.filter(([ep]) => ep === EP.EP_PUT_WORKFLOW)
    // 首存返回后补发一次：载荷 = 第二次调用的最新内容（新坐标）
    expect(puts).toHaveLength(2)
    const secondPayload = (puts[1]![1] as { flow: WorkflowDocument }).flow
    expect(secondPayload.id).toBe('flow-a')
    expect(secondPayload.nodes[0]!.position).toEqual({ x: 7, y: 9 })
    // 两次调用都解析为「包含自己内容的最终落库结果」
    const r1 = await (p1 as Promise<WorkflowDocument | null> | null)
    const r2 = await (p2 as Promise<WorkflowDocument | null> | null)
    expect(r1?.revision).toBe(3)
    expect(r1).toEqual(r2)
  })

  it('补发载荷为最新坐标：第二次保存的新节点位置覆盖首存内容', async () => {
    const dFirst = deferred<WorkflowDocument>()
    let putCount = 0
    const call = vi.fn(async (endpoint: string, args: { flow: WorkflowDocument }) => {
      putCount += 1
      if (putCount === 1) return dFirst.promise
      return { ...args.flow, revision: 9 }
    })
    const remote = { call } as unknown as RemoteFace
    const face = await renderFace(remote)
    const flowA = makeFlow('flow-a', '工作流A')

    const p1 = face.saveWorkflow(flowA, [{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: {} }] as never, [])
    const p2 = face.saveWorkflow(flowA, [{ id: 'n1', kind: 'agent', position: { x: 120, y: 64 }, data: {} }] as never, [])
    await Promise.resolve()
    await act(async () => {
      dFirst.resolve({ ...flowA, revision: 1 })
      await Promise.all([p1, p2])
    })

    const puts = call.mock.calls.filter(([ep]) => ep === EP.EP_PUT_WORKFLOW)
    expect(puts).toHaveLength(2)
    expect((puts[0]![1] as { flow: WorkflowDocument }).flow.nodes[0]!.position).toEqual({ x: 0, y: 0 })
    expect((puts[1]![1] as { flow: WorkflowDocument }).flow.nodes[0]!.position).toEqual({ x: 120, y: 64 })
  })

  it('保存失败 → 不派发 WORKFLOW_UPDATED（列表不被失败结果污染）', async () => {
    const call = vi.fn(async () => { throw new Error('409 conflict') })
    const remote = { call } as unknown as RemoteFace
    const dispatched: string[] = []
    let face: WorkflowsFace | null = null
    function Harness(): null {
      face = useWorkflows(((action: { type: string }) => { dispatched.push(action.type) }) as never, remote)
      return null
    }
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(Harness))
    })

    await expect(face!.saveWorkflow(makeFlow('flow-a', '工作流A'), [], [])).rejects.toThrow('409 conflict')
    expect(dispatched).not.toContain('WORKFLOW_UPDATED')
  })
})

describe('serializeWorkflow（Bug 2 回归）', () => {
  it('虚拟节点顶层 proxySourceId 保留', () => {
    const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', revision: 0 } as WorkflowDocument
    const nodes = [
      { id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, data: {}, proxySourceId: 'n1' },
    ] as unknown as WorkflowDocument['nodes']
    const out = serializeWorkflow(flow, nodes as never, [] as never)
    const proxy = out.nodes.find((n) => n.id === 'p1') as { proxySourceId?: string }
    expect(proxy?.proxySourceId).toBe('n1')
  })

  it('非虚拟节点不带 proxySourceId 字段（投影与序列化对称）', () => {
    const flow = { id: 'wf-1', sessionId: 's-1', mode: 'mode1', name: '', description: '', revision: 0 } as WorkflowDocument
    const nodes = [{ id: 'n1', kind: 'agent', position: { x: 0, y: 0 }, data: { label: 'A' } }] as unknown as WorkflowDocument['nodes']
    const out = serializeWorkflow(flow, nodes as never, [] as never)
    expect(Object.prototype.hasOwnProperty.call(out.nodes[0], 'proxySourceId')).toBe(false)
  })
})
