// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useFlowTemplatesPolling.test.tsx
//
// P2 自主编排：工作流模板列表轮询（父代理经 wf_graph_patch 在宿主侧产出的模板
// 必须能被客户端看见）。覆盖三件事：
//   1. 签名纯函数（同内容同签名 / revision 或 updatedAt 变化即变）；
//   2. reducer 的 FLOW_TEMPLATES_SYNCED：保留本地未落盘草稿，其余以服务端为准；
//   3. hook：挂载即拉一次并 dispatch；内容不变不重复 dispatch；变化即 dispatch；
//      远端失败静默下轮重试；卸载清理定时器。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import {
  FLOW_TEMPLATES_POLL_MS,
  flowTemplatesSignature,
  useFlowTemplatesPolling,
} from '../../../src/client/hooks/useFlowTemplatesPolling.js'
import { studioReducer } from '../../../src/client/studio/studio-reducer.js'
import { createInitialState } from '../../../src/client/studio/studio-initial.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { StudioAction } from '../../../src/client/studio/studio-actions.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { WorkflowTemplate } from '../../../src/host/shared/graph-model.js'
import type { Drafted } from '../../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  // 只假定时器（setInterval/clearInterval），保留真实 microtask——否则 React act 的
  // 异步冲刷调度也被假掉，会打印「update not wrapped in act」噪声告警。
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 构造模板（只填签名相关字段 + 列表渲染所需最小字段）。 */
function tpl(id: string, revision: number, updatedAt: string, extra: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return { id, mode: 'mode1', name: id, description: '', revision, nodes: [], lines: [], updatedAt, ...extra }
}

/**
 * 挂载一个只调用本 hook 的探针组件，并在 act 内把挂载时的首轮异步轮询冲刷干净
 * （否则首轮 dispatch 落在 act 之外，React 会打印 act 警告）。
 */
async function mountProbe(dispatch: (a: StudioAction) => void, remote: RemoteFace): Promise<void> {
  function Probe(): null {
    useFlowTemplatesPolling(dispatch as never, remote)
    return null
  }
  root = createRoot(container!)
  await act(async () => {
    root!.render(React.createElement(Probe))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('P2 模板列表轮询 · 签名纯函数', () => {
  it('同内容同签名；id 顺序无关（排序后拼接）', () => {
    const a = [tpl('t1', 1, '2026-01-01'), tpl('t2', 2, '2026-01-02')]
    const b = [tpl('t2', 2, '2026-01-02'), tpl('t1', 1, '2026-01-01')]
    expect(flowTemplatesSignature(a)).toBe(flowTemplatesSignature(b))
  })

  it('revision / updatedAt 变化即签名变化（轮询据此判定是否需要 dispatch）', () => {
    const base = tpl('t1', 1, '2026-01-01')
    expect(flowTemplatesSignature([base])).not.toBe(flowTemplatesSignature([tpl('t1', 2, '2026-01-01')]))
    expect(flowTemplatesSignature([base])).not.toBe(flowTemplatesSignature([tpl('t1', 1, '2026-01-02')]))
  })

  it('空列表与缺失 revision/updatedAt 不崩', () => {
    expect(flowTemplatesSignature([])).toBe('')
    expect(flowTemplatesSignature([{ id: 't1' } as WorkflowTemplate])).toBe('t1:0:')
  })
})

describe('P2 模板列表轮询 · reducer 同步保留草稿', () => {
  it('FLOW_TEMPLATES_SYNCED：服务端列表替换非草稿项，本地草稿仍在前', () => {
    const draft = { ...tpl('draft-1', 0, ''), _draft: true } as Drafted<WorkflowTemplate>
    const state = { ...createInitialState('s-1'), flowTemplates: [draft, tpl('t1', 1, '2026-01-01')] }
    const next = studioReducer(state, { type: 'FLOW_TEMPLATES_SYNCED', items: [tpl('t1', 2, '2026-01-02'), tpl('t2', 1, '2026-01-03')] })
    expect(next.flowTemplates.map((item) => item.id)).toEqual(['draft-1', 't1', 't2'])
    expect(next.flowTemplates[1].revision).toBe(2)
  })

  it('FLOW_TEMPLATES_SYNCED 不影响当前文档/画布（只换列表）', () => {
    const state = createInitialState('s-1')
    const next = studioReducer(state, { type: 'FLOW_TEMPLATES_SYNCED', items: [tpl('t1', 1, '2026-01-01')] })
    expect(next.currentId).toBe(state.currentId)
    expect(next.canvas).toEqual(state.canvas)
    expect(next.dirty).toBe(state.dirty)
  })
})

describe('P2 模板列表轮询 · hook 行为', () => {
  it('挂载即拉一次并 dispatch FLOW_TEMPLATES_SYNCED', async () => {
    const calls: string[] = []
    const actions: StudioAction[] = []
    const remote = { async call(ep: string) { calls.push(ep); return [tpl('t1', 1, '2026-01-01')] } } as unknown as RemoteFace
    await mountProbe((a) => actions.push(a), remote)
    await act(async () => { await Promise.resolve() })
    expect(calls).toEqual([EP.EP_LIST_FLOW_TEMPLATES])
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'FLOW_TEMPLATES_SYNCED' })
  })

  it('内容不变：后续轮询不再 dispatch（只多一次远端调用）', async () => {
    const calls: string[] = []
    const actions: StudioAction[] = []
    const remote = { async call(ep: string) { calls.push(ep); return [tpl('t1', 1, '2026-01-01')] } } as unknown as RemoteFace
    await mountProbe((a) => actions.push(a), remote)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(FLOW_TEMPLATES_POLL_MS) })
    await act(async () => { await Promise.resolve() })
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(actions).toHaveLength(1)
  })

  it('内容变化（代理产出新模板）：下一轮 dispatch 新列表', async () => {
    let items: WorkflowTemplate[] = [tpl('t1', 1, '2026-01-01')]
    const actions: StudioAction[] = []
    const remote = { async call() { return items } } as unknown as RemoteFace
    await mountProbe((a) => actions.push(a), remote)
    await act(async () => { await Promise.resolve() })
    items = [tpl('t1', 1, '2026-01-01'), tpl('tpl-new', 1, '2026-01-05')]
    await act(async () => { vi.advanceTimersByTime(FLOW_TEMPLATES_POLL_MS) })
    await act(async () => { await Promise.resolve() })
    expect(actions).toHaveLength(2)
    const last = actions[1] as { type: string; items: WorkflowTemplate[] }
    expect(last.type).toBe('FLOW_TEMPLATES_SYNCED')
    expect(last.items.map((item) => item.id)).toContain('tpl-new')
  })

  it('远端失败：静默吞掉，不 dispatch，不抛错', async () => {
    const actions: StudioAction[] = []
    const remote = { async call() { throw new Error('network down') } } as unknown as RemoteFace
    await expect(mountProbe((a) => actions.push(a), remote)).resolves.toBeUndefined()
    expect(actions).toHaveLength(0)
  })

  it('非数组返回按空列表处理（不崩）', async () => {
    const actions: StudioAction[] = []
    const remote = { async call() { return null } } as unknown as RemoteFace
    await mountProbe((a) => actions.push(a), remote)
    await act(async () => { await Promise.resolve() })
    expect(actions).toHaveLength(1)
  })

  it('卸载清理定时器：不再继续轮询', async () => {
    let count = 0
    const remote = { async call() { count += 1; return [] } } as unknown as RemoteFace
    await mountProbe(() => {}, remote)
    await act(async () => { await Promise.resolve() })
    const before = count
    act(() => { root!.unmount() })
    root = null
    await act(async () => { vi.advanceTimersByTime(FLOW_TEMPLATES_POLL_MS * 3) })
    expect(count).toBe(before)
  })
})
