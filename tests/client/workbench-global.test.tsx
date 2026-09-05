// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/workbench-global.test.tsx
//
// 工作台全局化改版专项测试：
//   1. 「开启新会话」复选框仅模板态显示（实例态/空态不显示）；
//   2. 模板态创建实例：当前会话已有实例 → 弹覆盖确认；确认后复用旧实例 id 保存并打开；
//   3. 勾选「开启新会话」创建实例：先经 createSession 建立主会话，实例保存到新会话；
//   4. 实例列表 = 全部会话实例；当前主会话实例带「当前」标签，其他会话实例无。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Studio } from '../../src/client/studio/Studio.js'
import { zh } from '../../src/client/i18n.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import { EP } from '../../src/client/lib/remote.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../src/host/shared/graph-model.js'

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

function makeInstance(id: string, sessionId: string, name: string): WorkflowDocument {
  return {
    id,
    sessionId,
    mode: 'mode1',
    name,
    description: '',
    revision: 1,
    nodes: [],
    lines: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  }
}

function makeTemplate(): WorkflowTemplate {
  return {
    id: 'tpl-1',
    mode: 'mode1',
    name: '流程模板A',
    description: '',
    nodes: [],
    lines: [],
  }
}

/** 远端桩：可指定实例/模板/会话返回；记录全部调用。 */
function remoteStub(options: {
  workflows?: WorkflowDocument[]
  flowTemplates?: WorkflowTemplate[]
  newSessionId?: string
} = {}) {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      calls.push({ endpoint, args: args ?? {} })
      if (endpoint === EP.EP_LIST_WORKFLOWS) return options.workflows ?? []
      if (endpoint === EP.EP_LIST_FLOW_TEMPLATES) return options.flowTemplates ?? []
      if (endpoint === EP.EP_LIST_SERVICES) return []
      if (endpoint === EP.EP_ACTIVE_RUNS) return []
      if (endpoint === EP.EP_CREATE_SESSION) return { sessionId: options.newSessionId ?? 'session-new-1' }
      if (endpoint === EP.EP_PUT_WORKFLOW) {
        const flow = args?.flow as WorkflowDocument
        return { ...flow, revision: (Number(flow.revision ?? 0) + 1) }
      }
      return []
    }),
  }
  return { remote, calls }
}

async function renderStudio(remote: RemoteFace): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Studio, { t: zh, sessionId: 's-1', remote }))
  })
  // 冲掉 boot 异步链（列表加载 → 自动选中等多级 dispatch）
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** 点击左侧「工作流」Tab 下「工作流模板」分组的模板卡（打开模板态；按分组定位，
 *  避免与同名实例卡混淆——覆盖后实例名会同步为模板名）。 */
async function openTemplate(): Promise<void> {
  await act(async () => {
    const groups = Array.from(document.querySelectorAll<HTMLDivElement>('.wf-docgroup'))
    const tplGroup = groups.find((item) => item.textContent?.includes('工作流模板'))
    const card = tplGroup?.parentElement?.querySelector<HTMLButtonElement>('.wf-docitem')
    card?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
    card?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
  })
}

/** 点击工具栏按钮（按文案匹配）。 */
async function clickToolbar(text: string): Promise<void> {
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button'))
      .find((item) => item.textContent === text)?.click()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('工作台全局化：「开启新会话」仅模板态 + 创建/覆盖/新会话链路', () => {
  it('模板态显示「开启新会话」复选框；创建实例后实例态不再显示', async () => {
    const { remote } = remoteStub({ flowTemplates: [makeTemplate()] })
    await renderStudio(remote)
    // 空态/实例态初始：不显示
    expect(document.querySelector('.wf-toolbar__switch')).toBeNull()
    await openTemplate()
    // 模板态：显示
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type=checkbox]')
    expect(checkbox).toBeTruthy()
    // 勾选后出现工作区输入框
    await act(async () => {
      checkbox!.click()
    })
    expect(document.querySelector('.wf-toolbar__workspace')).toBeTruthy()
  })

  it('模板态创建实例（当前会话已有实例）→ 弹覆盖确认；确认后复用旧实例 id 保存', async () => {
    const existing = makeInstance('wf-existing', 's-1', '旧实例')
    const { remote, calls } = remoteStub({ workflows: [existing], flowTemplates: [makeTemplate()] })
    await renderStudio(remote)
    await openTemplate()
    await clickToolbar(zh.createInstance)
    // 二次确认框（用户批注文案）
    const confirm = document.querySelector('.wf-confirm')
    expect(confirm).toBeTruthy()
    expect(confirm?.textContent).toContain(zh.overwriteInstanceMessage)
    await act(async () => {
      Array.from(confirm!.querySelectorAll('button')).find((item) => item.textContent === zh.overwriteInstanceConfirm)?.click()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // 覆盖确认后：复用旧实例 id（PUT sessionId=s-1、flow.id=wf-existing），不创建新会话
    const put = calls.find((call) => call.endpoint === EP.EP_PUT_WORKFLOW)
    expect(put).toBeTruthy()
    expect(put?.args.sessionId).toBe('s-1')
    expect((put?.args.flow as WorkflowDocument)?.id).toBe('wf-existing')
    expect((put?.args.flow as WorkflowDocument)?.name).toBe('流程模板A')
    expect(calls.some((call) => call.endpoint === EP.EP_CREATE_SESSION)).toBe(false)
    // 拒绝后（取消）不应保存 —— 再触发一次并点「取消」
    await openTemplate()
    await clickToolbar(zh.createInstance)
    const confirm2 = document.querySelector('.wf-confirm')!
    await act(async () => {
      Array.from(confirm2.querySelectorAll('button')).find((item) => item.textContent === zh.unsavedCancel)?.click()
    })
    const putCount = calls.filter((call) => call.endpoint === EP.EP_PUT_WORKFLOW).length
    expect(putCount).toBe(1)
  })

  it('勾选「开启新会话」创建实例：先建主会话，实例保存到新会话（一次性动作）', async () => {
    const { remote, calls } = remoteStub({ flowTemplates: [makeTemplate()], newSessionId: 'session-new-1' })
    await renderStudio(remote)
    await openTemplate()
    // 勾选开启新会话 + 填写工作区
    await act(async () => {
      const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type=checkbox]')
      checkbox!.click()
    })
    await act(async () => {
      // React 受控输入：需经原生 value setter + input 事件触发 onChange（jsdom）
      const workspace = document.querySelector<HTMLInputElement>('.wf-toolbar__workspace')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(workspace, 'D:\\work\\project')
      workspace!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickToolbar(zh.createInstance)
    // 先创建会话（携带来源会话与工作区），实例 PUT 归属新会话
    const sessionCall = calls.find((call) => call.endpoint === EP.EP_CREATE_SESSION)
    expect(sessionCall).toBeTruthy()
    expect(sessionCall?.args.sessionId).toBe('s-1')
    expect(sessionCall?.args.workspacePath).toBe('D:\\work\\project')
    const put = calls.find((call) => call.endpoint === EP.EP_PUT_WORKFLOW)
    expect(put).toBeTruthy()
    expect(put?.args.sessionId).toBe('session-new-1')
    // 实例态：按钮变「保存实例」且复选框消失
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button'))
      .map((item) => item.textContent)).toContain(zh.saveInstance)
    expect(document.querySelector('.wf-toolbar__switch')).toBeNull()
  })

  it('实例列表 = 全部会话实例；当前主会话实例带「当前」标签，其他会话实例不带', async () => {
    const instances = [
      makeInstance('wf-current', 's-1', '当前会话实例'),
      makeInstance('wf-other', 'session-other', '其他会话实例'),
    ]
    const { remote } = remoteStub({ workflows: instances })
    await renderStudio(remote)
    const labels = textOf('.wf-docitem__label')
    expect(labels).toContain('当前会话实例')
    expect(labels).toContain('其他会话实例')
    // 「当前」徽标只出现在当前主会话（s-1）对应实例卡上
    const currentBadges = textOf('.wf-docitem__badge.is-current')
    expect(currentBadges).toEqual([zh.currentSessionBadge])
    const currentCard = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem'))
      .find((item) => item.textContent?.includes('当前会话实例'))
    expect(currentCard?.textContent).toContain(zh.currentSessionBadge)
    const otherCard = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem'))
      .find((item) => item.textContent?.includes('其他会话实例'))
    expect(otherCard?.textContent).not.toContain(zh.currentSessionBadge)
  })
})

function textOf(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((item) => item.textContent ?? '')
}
