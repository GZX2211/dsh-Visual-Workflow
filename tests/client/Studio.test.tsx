// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/Studio.test.tsx
//
// 工作台装配冒烟（照搬旧项目渲染路径验证）：标题顶栏（工作流设计器一行 + 导入/导出/模式/组合）、
// 画布控制栏（撤销/重做/清空/整理布局/保存/运行/运行历史）、左侧 4 Tab（工作流/角色/数据/其他）、
// 画布空态引导；角色模板列表渲染与选中 → 右侧属性面板。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Studio, pickInitialInstance } from '../../src/client/studio/Studio.js'
import { zh } from '../../src/client/i18n.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import { EP } from '../../src/client/lib/remote.js'

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
})

function remoteStub(): RemoteFace & { calls: Array<{ endpoint: string; args: Record<string, unknown> }> } {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      calls.push({ endpoint, args: args ?? {} })
      if (endpoint === EP.EP_LIST_TEMPLATES && String(args?.kind ?? '') === 'role') {
        return [
          { id: 'r-1', kind: 'agent', name: '研究员', systemPrompt: '' },
          { id: 'r-2', kind: 'agent', name: '测试工程师', systemPrompt: '' },
          { id: 'r-3', kind: 'agent', name: '全栈开发工程师', systemPrompt: '' },
        ]
      }
      // 协作组模板列表（用户批注：+ 新增/点击编辑；测试拖入「协作组」卡建组节点）
      if (endpoint === EP.EP_LIST_TEMPLATES && String(args?.kind ?? '') === 'group') {
        return [{ id: 'g-1', name: '协作组', collabPrompt: '' }]
      }
      if (endpoint === EP.EP_PRESETS) return [{ id: 'standard', name: '标准' }]
      if (endpoint === EP.EP_MODELS) return [{ provider: 'deepseek', model: 'deepseek-chat' }]
      if (endpoint === EP.EP_RUN_HISTORY) {
        return [{ id: 'run-9', flowId: 'x', status: 'interrupted', startedAt: '2026-08-23T10:00:00.000Z', summary: '中断于节点' }]
      }
      if (endpoint === EP.EP_RUN_RESUME) return { runId: 'run-10' }
      if (endpoint === EP.EP_ACTIVE_RUNS) return [] // 无活跃 run（默认）
      if (endpoint === EP.EP_LIST_WORKFLOWS) return [] // 无实例（默认；自动选中保持空白画布）
      if (endpoint === EP.EP_PUT_WORKFLOW || endpoint === EP.EP_PUT_FLOW_TEMPLATE) {
        // 保存端点须回传完整文档（含 id/revision），否则调用方后续 openFlow 拿到
        // 缺失 id 的假对象，画布无法绑定实例（图2 改造：模板→实例链路依赖此回传）
        const doc = args?.flow ?? args?.template
        return { ...(doc as object), revision: 1 }
      }
      if (endpoint === EP.EP_LIST_FLOW_TEMPLATES) return []
      return []
    }),
  }
  return { ...remote, calls }
}

async function renderStudio(): Promise<void> {
  await renderStudioWith(remoteStub())
}

async function renderStudioWith(remote: RemoteFace): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(
      React.createElement(Studio, { t: zh, sessionId: 's-1', remote }),
    )
  })
}

function textOf(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((item) => item.textContent ?? '')
}

/** pointer 点击（模拟左面板卡片的 pointerdown+up 点击路径）。 */
function pointerClick(el: Element): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
}

describe('Studio 装配', () => {
  it('标题顶栏 = 工作流设计器一行（无额外标题栏）；导入/导出/模式/组合/关闭按钮', async () => {
    await renderStudio()
    expect(textOf('.wf-titlebar__title')).toEqual(['工作流设计器'])
    expect(textOf('.wf-titlebar__badge')).toEqual(['可视化编排'])
    const buttons = textOf('.wf-tabs .wf-btn').join('|')
    expect(buttons).toContain('组合')
    expect(buttons).toContain('导入')
    expect(buttons).toContain('导出')
    expect(buttons).toContain('流程编排模式')
  })

  it('画布控制栏：撤销/重做/清空/整理布局/保存/运行/运行历史', async () => {
    await renderStudio()
    const toolbar = document.querySelector('.wf-toolbar')
    expect(toolbar).toBeTruthy()
    expect(toolbar?.querySelector('[title*="撤销"]')).toBeTruthy()
    expect(toolbar?.querySelector('[title*="重做"]')).toBeTruthy()
    // 图2 改造：初始无选中对象 → 实例态按钮文案为「保存实例」
    expect(textOf('.wf-toolbar .wf-btn')).toEqual(expect.arrayContaining(['清空', '整理布局', '保存实例', '运行', '运行历史']))
  })

  it('保存按钮只写入工作流，不触发运行（单一职责）', async () => {
    const remote = remoteStub()
    await renderStudioWith(remote)
    await createDraft()
    await act(async () => {
      // 图2 改造：+ 号新建的是模板草稿，工具栏按钮为「创建实例」；
      // 点击后应保存实例（PUT_WORKFLOW）而不触发运行（EP_RUN）。
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button')).find((item) => item.textContent === zh.createInstance)?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(remote.calls.some((call) => call.endpoint === EP.EP_RUN)).toBe(false)
    expect(remote.calls.some((call) => call.endpoint === EP.EP_PUT_WORKFLOW)).toBe(true)
  })

  it('左侧栏 4 Tab：工作流/角色/数据/其他；数据 Tab 含文件/数据库分区', async () => {
    await renderStudio()
    expect(textOf('.wf-lib-tab')).toEqual(['工作流', '角色', '数据', '其他'])
    await act(async () => {
      const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '数据')
      tab?.click()
    })
    const groups = textOf('.wf-docgroup').join('|')
    expect(groups).toContain('文件')
    expect(groups).toContain('数据库')
    await act(async () => {
      const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '其他')
      tab?.click()
    })
    const otherGroups = textOf('.wf-docgroup').join('|')
    expect(otherGroups).toContain('阶段')
    expect(otherGroups).toContain('协作组')
  })

  it('画布空态引导 + 角色模板列表 + 选中进入右侧属性面板', async () => {
    await renderStudio()
    expect(document.querySelector('.wf-canvas-empty')?.textContent).toContain('从左侧拖入卡片开始编排')
    await act(async () => {
      const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '角色')
      tab?.click()
    })
    expect(textOf('.wf-docitem__label')).toEqual(expect.arrayContaining(['研究员']))
    await act(async () => {
      const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem')).find((item) => item.textContent?.includes('研究员'))
      if (card) pointerClick(card)
    })
    const inputs = Array.from(document.querySelectorAll('.wf-inspector input')) as HTMLInputElement[]
    expect(inputs.some((input) => input.value === '研究员')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 交互用例：清空二次确认+可撤销 / 模式切换守卫 / 运行历史恢复入口
// ---------------------------------------------------------------------------

/** 新建工作流草稿（点击工作流 tab 分区 ＋ 按钮）。 */
async function createDraft(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
  })
}

/** 把左侧卡片拖到画布指定屏幕位置（拖拽行进路线统一）。 */
async function dragCardTo(cardText: string, clientX: number, clientY: number): Promise<void> {
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
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }))
  })
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX, clientY }))
  })
}

/** 拖拽角色模板到画布（pointer 路径与真实交互一致）。 */
async function dragRoleToCanvas(): Promise<void> {
  await dragCardTo('研究员', 220, 220)
}

function nodeCount(): number {
  return document.querySelectorAll('.wf-node').length
}

describe('Studio 交互', () => {
  it('清空画布：二次确认（按钮文案=清空）→ 清空后可撤销恢复', async () => {
    await renderStudio()
    await createDraft()
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '角色')?.click()
    })
    await dragRoleToCanvas()
    expect(nodeCount()).toBe(1)

    // 清空 → 确认框（确认按钮文案为"清空"而非默认"删除"）
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title*="清空"]')?.click()
    })
    const confirmDialog = document.querySelector('.wf-confirm')
    expect(confirmDialog).toBeTruthy()
    expect(confirmDialog?.textContent).toContain(zh.clearCanvasHint)
    const confirmButtons = Array.from(confirmDialog!.querySelectorAll('button')).map((item) => item.textContent)
    expect(confirmButtons).toContain(zh.clear)
    await act(async () => {
      Array.from(confirmDialog!.querySelectorAll('button')).find((item) => item.textContent === zh.clear)?.click()
    })
    expect(nodeCount()).toBe(0)
    expect(document.querySelector('.wf-canvas-empty')).toBeTruthy()

    // 撤销恢复
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[title*="撤销"]')?.click()
    })
    expect(nodeCount()).toBe(1)
  })

  it('模式切换守卫：未保存修改 → 确认框，取消后模式不变', async () => {
    await renderStudio()
    await createDraft()
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '角色')?.click()
    })
    await dragRoleToCanvas()

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-titlebar__mode .wf-btn')).find((item) => item.textContent?.includes(zh.mode1))?.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-mode-menu__item')).find((item) => item.textContent === zh.mode2)?.click()
    })
    const confirmDialog = document.querySelector('.wf-confirm')
    expect(confirmDialog?.textContent).toContain(zh.unsavedMessage)
    await act(async () => {
      Array.from(confirmDialog!.querySelectorAll('button')).find((item) => item.textContent === zh.unsavedCancel)?.click()
    })
    expect(document.querySelector('.wf-confirm')).toBeNull()
    expect(document.querySelector('.wf-titlebar__mode')?.textContent).toContain(zh.mode1)
  })

  it('运行历史：interrupted 记录可恢复；点击恢复触发 runResume', async () => {
    const remote = remoteStub()
    await renderStudioWith(remote)
    await createDraft()
    // 图2 改造：+ 号新建模板草稿；运行历史属于实例——先「创建实例」切到实例态
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button')).find((item) => item.textContent === zh.createInstance)?.click()
    })
    // 刷新完整微任务链（saveWorkflow → WORKFLOW_UPDATED → openFlow 多级 dispatch）
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // 实例态确认：工具栏按钮应变为「保存实例」
    expect(textOf('.wf-toolbar .wf-btn')).toContain(zh.saveInstance)
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button')).find((item) => item.textContent === zh.history)?.click()
    })
    const historyPanel = document.querySelector('.wf-history')
    expect(historyPanel).toBeTruthy()
    expect(historyPanel?.textContent).toContain('已中断')
    expect(historyPanel?.textContent).toContain('中断于节点')
    const resumeButton = Array.from(historyPanel!.querySelectorAll('button')).find((item) => item.textContent === zh.resumeRun)
    expect(resumeButton).toBeTruthy()
    await act(async () => {
      resumeButton?.click()
    })
    const resume = remote.calls.find((call) => call.endpoint === EP.EP_RUN_RESUME)
    expect(resume).toBeTruthy()
    expect(resume?.args).toMatchObject({ sessionId: 's-1', runId: 'run-9' })
  })

  it('协作组：画布角色节点拖入组卡片 → 组内迷你成员显示、画布大卡隐藏', async () => {
    await renderStudio()
    await createDraft()
    // 拖入协作组卡片（其他 Tab）
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '其他')?.click()
    })
    await dragCardTo('协作组', 500, 300)
    expect(document.querySelector('.wf-node--group')).toBeTruthy()

    // 拖入角色节点（角色 Tab）
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '角色')?.click()
    })
    await dragCardTo('研究员', 380, 380)
    const roleNode = document.querySelector<HTMLDivElement>('.wf-graph__node .wf-node--agent')
    expect(roleNode).toBeTruthy()

    // 把画布角色节点拖到组卡片上（mock elementsFromPoint：jsdom 无布局命中）
    const groupEl = document.querySelector('.wf-group-node') as HTMLElement
    const original = document.elementFromPoint
    const originalMany = document.elementsFromPoint
    // 入组落点判定走 elementsFromPoint（多元素栈）；jsdom 需手动 mock
    document.elementsFromPoint = () => [groupEl]
    document.elementFromPoint = () => groupEl
    try {
      await act(async () => {
        roleNode!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 380, clientY: 380, button: 0 }))
      })
      await act(async () => {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 500, clientY: 340 }))
      })
      await act(async () => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 500, clientY: 340 }))
      })
    } finally {
      document.elementFromPoint = original
      document.elementsFromPoint = originalMany
    }

    // 组内迷你成员（含 ctx/db 接点已渲染）；画布上不再显示角色大卡
    const memberNames = Array.from(document.querySelectorAll('.wf-group__member-name')).map((item) => item.textContent)
    expect(memberNames).toContain('研究员')
    expect(document.querySelector('.wf-group__member .wf-graph__handle--mini')).toBeTruthy()
    const standaloneRoles = Array.from(document.querySelectorAll('.wf-graph__node .wf-node--agent'))
    expect(standaloneRoles.length).toBe(0)
  })

  it('协作组：删除单个成员只移出一个，其余保留（用户批注：点了 1 个却移出多个）', async () => {
    await renderStudio()
    await createDraft()
    // 放入协作组（其他 tab）
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '其他')?.click()
    })
    await dragCardTo('协作组', 500, 300)
    const groupCard = document.querySelector('.wf-group-node') as HTMLElement
    expect(groupCard).toBeTruthy()

    // 角色 tab：依次拖入 3 个角色模板入组（mock elementsFromPoint 命中组表面）
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-tab')).find((item) => item.textContent === '角色')?.click()
    })
    const original = document.elementFromPoint
    const originalMany = document.elementsFromPoint
    document.elementFromPoint = () => groupCard
    document.elementsFromPoint = () => [groupCard]
    try {
      for (const name of ['研究员', '测试工程师', '全栈开发工程师']) {
        await dragCardTo(name, 500, 300)
      }
    } finally {
      document.elementFromPoint = original
      document.elementsFromPoint = originalMany
    }

    // 选中协作组 → 右侧组合成员应有 3 个
    await act(async () => {
      groupCard.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 300, button: 0 }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 500, clientY: 300, button: 0 }))
    })
    const memberLabels = (): string[] => Array.from(document.querySelectorAll('.wf-check-list label span')).map((s) => s.textContent ?? '')
    expect(memberLabels()).toEqual(expect.arrayContaining(['研究员', '测试工程师', '全栈开发工程师']))

    // 点击「全栈开发工程师」的 ✕ → 只移出该成员，其余保留
    const row = Array.from(document.querySelectorAll('.wf-check-list label')).find((lab) => lab.textContent?.includes('全栈开发工程师'))
    expect(row).toBeTruthy()
    await act(async () => {
      (row!.querySelector('button') as HTMLButtonElement)?.click()
    })
    const after = memberLabels()
    expect(after).not.toContain('全栈开发工程师')
    expect(after).toContain('研究员')
    expect(after).toContain('测试工程师')
    const memberMini = Array.from(document.querySelectorAll('.wf-group__member-name')).map((s) => s.textContent ?? '')
    expect(memberMini).not.toContain('全栈开发工程师')
    expect(memberMini).toContain('研究员')
  })
})

// ---------------------------------------------------------------------------
// pickInitialInstance：进入工作台自动选中实例（用户新增需求）
// ---------------------------------------------------------------------------

describe('pickInitialInstance：进入工作台自动选中实例', () => {
  const instances = [
    { id: 'flow-a', name: '流程A' },
    { id: 'flow-b', name: '流程B' },
    { id: 'flow-c', name: '流程C' },
  ]

  it('实例列表为空 → null（保持空白画布）', () => {
    expect(pickInitialInstance([], [])).toBeNull()
  })

  it('无活跃 run → 选列表第一个', () => {
    expect(pickInitialInstance(instances, [])).toBe('flow-a')
    expect(pickInitialInstance(instances, [{ flowId: '不存在', status: 'running' }])).toBe('flow-a')
  })

  it('有 running 实例 → 优先运行中的（即使不是第一个）', () => {
    const active = [
      { flowId: 'flow-b', status: 'running' },
      { flowId: 'flow-c', status: 'paused' },
    ]
    expect(pickInitialInstance(instances, active)).toBe('flow-b')
  })

  it('无 running 但有 paused → 选暂停的实例', () => {
    const active = [{ flowId: 'flow-c', status: 'paused' }]
    expect(pickInitialInstance(instances, active)).toBe('flow-c')
  })

  it('activeRuns 的 flowId 不在实例列表中 → 忽略该条目，回退列表第一个', () => {
    const active = [{ flowId: 'flow-ghost', status: 'running' }]
    expect(pickInitialInstance(instances, active)).toBe('flow-a')
  })

  it('running 优先于 paused（同列表存在时）', () => {
    const active = [
      { flowId: 'flow-c', status: 'paused' },
      { flowId: 'flow-a', status: 'running' },
    ]
    expect(pickInitialInstance(instances, active)).toBe('flow-a')
  })
})
