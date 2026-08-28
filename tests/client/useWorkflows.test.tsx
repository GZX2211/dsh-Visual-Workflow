// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/useWorkflows.test.tsx
//
// Bug 清单 P1 回归：saveWorkflow 的在途去重必须按 flowId 区分——保存工作流 A
// 未完成时切换到工作流 B 保存，B 必须独立持久化（修复前会复用 A 的在途
// Promise，B 内容丢失：「保存成功」但实际没保存）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useWorkflows, type WorkflowsFace } from '../../src/client/hooks/useWorkflows.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import { EP } from '../../src/client/lib/remote.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'

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
    const f = useWorkflows(vi.fn(), remote, 's-1')
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

  it('同一工作流的重复保存仍复用同一在途请求（不重复 PUT）', async () => {
    const dA = deferred<WorkflowDocument>()
    const call = vi.fn((endpoint: string, args: { flow: WorkflowDocument }) => {
      if (args.flow.id === 'flow-a') return dA.promise
      return Promise.resolve(args.flow)
    })
    const remote = { call } as unknown as RemoteFace
    const face = await renderFace(remote)
    const flowA = makeFlow('flow-a', '工作流A')

    let p1: Promise<WorkflowDocument | null> | null = null
    let p2: Promise<WorkflowDocument | null> | null = null
    // 同一工作流两次保存：第二次应复用同一在途请求（只一次 PUT）
    p1 = face.saveWorkflow(flowA, [], [])
    p2 = face.saveWorkflow(flowA, [], [])
    await Promise.resolve()
    expect(call.mock.calls.filter(([ep]) => ep === EP.EP_PUT_WORKFLOW)).toHaveLength(1)

    await act(async () => {
      dA.resolve({ ...flowA, revision: 2 })
      await Promise.all([p1, p2])
    })
    // 两次调用都成功且结果一致（await 后重新读值，避免控制流收窄为 never）
    const r1 = await (p1 as Promise<WorkflowDocument | null> | null)
    const r2 = await (p2 as Promise<WorkflowDocument | null> | null)
    expect(r1?.id).toBe('flow-a')
    expect(r1).toEqual(r2)
  })
})