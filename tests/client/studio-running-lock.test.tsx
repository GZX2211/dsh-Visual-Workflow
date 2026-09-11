// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio-running-lock.test.tsx
//
// 工作台装配级验证（运行中实例）：
//   ① 启动即选中「运行中」实例 → 工具栏「清空」禁用（title 提示先停止运行）；
//   ② 画布锁定视觉：已完成节点锁角标 + 其连线 is-locked、点击不选中（属性栏不展开）；
//   ③ 「保存实例」→ 二次确认（提示会改变父代理后续编排），确认后才落库；
//   ④ 节点删除不再二次确认（画布内节点删除直接生效）。
//
// 说明：运行态经 EP_ACTIVE_RUNS + EP_RUN_STATUS（快照含节点状态）驱动，
// 与真实宿主数据通路一致。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Studio } from '../../src/client/studio/Studio.js'
import { zh } from '../../src/client/i18n.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import { EP } from '../../src/client/lib/remote.js'
import type { RunSnapshot } from '../../src/host/shared/types.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  localStorage.clear()
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

/** 角色节点夹具（data 全量内联，与持久化文档一致）。 */
function roleNode(id: string, label: string, x: number, y: number): WorkflowDocument['nodes'][number] {
  return {
    id,
    kind: 'agent',
    position: { x, y },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

/** 运行中实例：n-done 已完成（ok），l-1 为其出线（锁）。 */
function runningFlow(): WorkflowDocument {
  return {
    id: 'wf-1',
    sessionId: 's-1',
    mode: 'mode1',
    name: '运行中流程',
    description: '',
    revision: 1,
    nodes: [
      roleNode('n-done', '已完成节点', 40, 40),
      roleNode('n-next', '待执行节点', 40, 240),
      { id: 'n-end', kind: 'end', position: { x: 320, y: 40 }, data: { label: '结束' } },
    ],
    lines: [
      { id: 'l-1', source: 'n-done', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      // 待执行节点的出线（未锁）：用于对照「非锁连线点击照常选中」
      { id: 'l-2', source: 'n-next', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 运行快照：n-done 已完成（ok）→ 该节点及其连线进入锁定范围。 */
function runningSnapshot(): RunSnapshot {
  return {
    id: 'run-1',
    flowId: 'wf-1',
    flowName: '运行中流程',
    sessionId: 's-1',
    mode: 'mode1',
    status: 'running',
    startedAt: '2026-02-01T00:00:00.000Z',
    endedAt: null,
    summary: '',
    nodes: [{
      nodeId: 'n-done',
      status: 'ok',
      attempts: 1,
      startedAt: '2026-02-01T00:00:00.000Z',
      endedAt: '2026-02-01T00:01:00.000Z',
      output: '完成',
      outputSummary: '完成',
    }],
  }
}

/** 远端桩：运行中实例 + 运行快照 + 模板/生态列表。 */
function runningRemote(): RemoteFace & { calls: Array<{ endpoint: string; args: Record<string, unknown> }> } {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      calls.push({ endpoint, args: args ?? {} })
      if (endpoint === EP.EP_LIST_WORKFLOWS) return [runningFlow()]
      if (endpoint === EP.EP_ACTIVE_RUNS) return [{ flowId: 'wf-1', sessionId: 's-1', status: 'running', runId: 'run-1' }]
      if (endpoint === EP.EP_RUN_STATUS) return runningSnapshot()
      if (endpoint === EP.EP_LIST_TEMPLATES && String(args?.kind ?? '') === 'role') {
        return [{ id: 'r-1', kind: 'agent', name: '研究员', systemPrompt: '' }]
      }
      if (endpoint === EP.EP_PRESETS) return [{ id: 'standard', name: '标准' }]
      if (endpoint === EP.EP_MODELS) return [{ provider: 'deepseek', model: 'deepseek-chat' }]
      if (endpoint === EP.EP_PUT_WORKFLOW) {
        const doc = args?.flow as WorkflowDocument
        return { ...doc, revision: Number(doc.revision ?? 1) + 1 }
      }
      if (endpoint === EP.EP_LIST_FLOW_TEMPLATES) return []
      return []
    }),
  }
  return { ...remote, calls }
}

async function renderStudio(remote: RemoteFace): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Studio, { t: zh, sessionId: 's-1', remote }))
  })
  // 首轮轮询（activeRuns / runStatus）刷新一轮
  await act(async () => {
    await Promise.resolve()
  })
}

/** 左栏卡片拖到画布（与真实 pointer 路径一致）。 */
async function dragCardTo(cardText: string): Promise<void> {
  const shell = document.querySelector('.wf-canvas-shell') as HTMLElement | null
  if (shell) {
    Object.defineProperty(shell, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
  }
  const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem')).find((item) => item.textContent?.includes(cardText))
  expect(card).toBeTruthy()
  await act(async () => {
    card!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
  })
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 600, clientY: 600 }))
  })
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 600, clientY: 600 }))
  })
}

describe('运行中实例：清空禁用 / 画布锁定 / 保存二次确认', () => {
  it('启动即选中运行中实例，且「清空」按钮禁用（title 提示先停止运行）', async () => {
    await renderStudio(runningRemote())
    const clearButton = document.querySelector<HTMLButtonElement>('.wf-toolbar button[title]')
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button')).find((item) => item.textContent === zh.clear)
    expect(clear).toBeTruthy()
    expect(clear!.disabled).toBe(true)
    expect(clear!.getAttribute('title')).toBe(zh.clearRunningHint)
    expect(clearButton).toBeTruthy()
  })

  it('画布锁定视觉：已完成节点锁角标 + 其连线 is-locked；点击被锁连线不选中、非锁连线照常选中', async () => {
    await renderStudio(runningRemote())
    const lockedCard = document.querySelector('[data-wf-node-id="n-done"] .wf-node')
    expect(lockedCard?.classList.contains('is-locked')).toBe(true)
    expect(lockedCard?.querySelector('.wf-node__lock-badge')?.textContent).toContain('🔒')

    // 被锁连线：is-locked + 点击不选中（属性栏不切到该连线，等价于不可编辑）
    const lockedGroup = document.querySelector('path.wf-graph__edge.is-locked')?.parentElement
    const lockedHit = lockedGroup?.querySelector('path.wf-graph__edge-hit')
    expect(lockedHit).toBeTruthy()
    await act(async () => {
      lockedHit!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(lockedGroup!.querySelector('path.wf-graph__edge')?.classList.contains('is-selected')).toBe(false)

    // 对照：非锁连线点击后进入选中态
    const freeGroup = Array.from(document.querySelectorAll('path.wf-graph__edge'))
      .filter((item) => !item.classList.contains('is-locked'))
      .map((item) => item.parentElement!)
    expect(freeGroup.length).toBeGreaterThan(0)
    await act(async () => {
      freeGroup[0]!.querySelector('path.wf-graph__edge-hit')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(freeGroup[0]!.querySelector('path.wf-graph__edge')?.classList.contains('is-selected')).toBe(true)
  })

  it('保存实例：运行中且有未保存改动 → 二次确认；确认后才 PUT', async () => {
    const remote = runningRemote()
    await renderStudio(remote)
    // 拖入一个新节点（未执行部分，允许修改）→ 产生未保存改动
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.getAttribute('aria-label') === '角色')?.click()
    })
    await dragCardTo('研究员')
    const putsBefore = remote.calls.filter((call) => call.endpoint === EP.EP_PUT_WORKFLOW).length

    // 点击「保存实例」→ 弹确认（未确认不落库）
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button')).find((item) => item.textContent === zh.saveInstance)?.click()
    })
    const dialog = document.querySelector('.wf-confirm')
    expect(dialog).toBeTruthy()
    expect(dialog?.textContent).toContain(zh.saveRunningMessage)
    expect(remote.calls.filter((call) => call.endpoint === EP.EP_PUT_WORKFLOW).length).toBe(putsBefore)

    // 确认 → 落库一次
    await act(async () => {
      Array.from(dialog!.querySelectorAll('button')).find((item) => item.textContent === zh.saveRunningConfirm)?.click()
      await Promise.resolve()
    })
    expect(remote.calls.filter((call) => call.endpoint === EP.EP_PUT_WORKFLOW).length).toBe(putsBefore + 1)
  })

  it('删除画布节点不再二次确认（选中未锁定节点 → 直接删除）', async () => {
    await renderStudio(runningRemote())
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.getAttribute('aria-label') === '角色')?.click()
    })
    await dragCardTo('研究员')
    const before = document.querySelectorAll('.wf-node').length

    // 选中新节点（拖入后已选中）→ 点击属性栏删除，不应弹确认框
    const deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-inspector button')).find((item) => item.textContent === zh.inspectorDelete)
    expect(deleteButton).toBeTruthy()
    await act(async () => {
      deleteButton!.click()
    })
    expect(document.querySelector('.wf-confirm')).toBeNull()
    expect(document.querySelectorAll('.wf-node').length).toBe(before - 1)
  })
})
