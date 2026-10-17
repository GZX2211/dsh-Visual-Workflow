// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/workbench-global.test.tsx
//
// 工作台全局化改版专项测试：
//   1. 「开启新会话」复选框仅实例来源态显示（实例态/空态不显示）；模板态勾选后出现
//      官方目录选择按钮，且勾选/路径变更立即保存进模板（模板级持久化配置）；
//   2. 模板态创建实例：当前会话已有实例 → 弹覆盖确认；确认后复用旧实例 id 保存并打开；
//   3. 打开模板恢复持久化的勾选与工作区 → 创建实例先经 createSession 建主会话并携带路径；
//   4. 官方目录选择器选择路径 → 保存进模板、显示在按钮右侧、创建实例时携带；
//   5. 实例列表 = 全部会话实例；当前主会话实例带「当前」标签，其他会话实例无。

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { flushAsync } from '../fixtures/async-flush.js'
import type { Root } from 'react-dom/client'
import { zh } from '../../../src/client/i18n.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import { EP } from '../../../src/client/lib/remote.js'
import { mountStudio, remoteStub, type RemoteStub } from '../fixtures/studio-harness.js'
import type { WorkflowDocument, WorkflowTemplate } from '../../../src/host/shared/graph-model.js'
import type { WorkspacePicker } from '../../../src/client/sidebar/workspace-picker.js'

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

/** 本文件专用远端桩：共享全集桩 + 「实例/模板/新会话」选项与 PUT 递增 revision 语义。 */
function wsRemoteStub(options: {
  workflows?: WorkflowDocument[]
  flowTemplates?: WorkflowTemplate[]
  newSessionId?: string
} = {}): { remote: RemoteStub; calls: RemoteStub['calls'] } {
  const remote = remoteStub({
    ...(options.workflows ? { workflows: options.workflows } : {}),
    ...(options.flowTemplates ? { flowTemplates: options.flowTemplates } : {}),
    ...(options.newSessionId ? { newSessionId: options.newSessionId } : {}),
    handlers: {
      [EP.EP_LIST_SERVICES]: () => [],
      [EP.EP_PUT_WORKFLOW]: (args) => {
        const flow = args.flow as WorkflowDocument
        return { ...flow, revision: Number(flow.revision ?? 0) + 1 }
      },
    },
  })
  return { remote, calls: remote.calls }
}

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

function makeTemplate(patch: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: 'tpl-1',
    mode: 'mode1',
    name: '流程模板A',
    description: '',
    nodes: [],
    lines: [],
    ...patch,
  }
}

/** 官方目录选择器替身（宿主接入层注入；模拟 Electron preload / uiWorkspace 任一通道可用）。 */
function pickerReturning(path: string | null): WorkspacePicker {
  return { available: () => true, pick: async () => path }
}

async function renderStudio(remote: RemoteFace, workspacePicker?: WorkspacePicker | null): Promise<void> {
  // flushBoot：冲掉 boot 异步链（列表加载 → 自动选中等多级 dispatch）。
  await mountStudio(container!, (next) => { root = next }, remote, {
    flushBoot: true,
    ...(workspacePicker !== undefined ? { workspacePicker } : {}),
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
  await flushAsync(2)
}

describe('工作台全局化：「开启新会话」仅模板态 + 创建/覆盖/新会话链路', () => {
  it('模板态显示「开启新会话」复选框；勾选后出现官方目录选择按钮；创建实例后实例态不再显示', async () => {
    const { remote, calls } = wsRemoteStub({ flowTemplates: [makeTemplate()] })
    await renderStudio(remote, pickerReturning(null))
    // 空态/实例态初始：不显示
    expect(document.querySelector('.wf-toolbar__switch')).toBeNull()
    await openTemplate()
    // 模板态：显示复选框（未勾选 → 不出现路径选择按钮）
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type=checkbox]')
    expect(checkbox).toBeTruthy()
    expect(checkbox!.checked).toBe(false)
    expect(document.querySelector('.wf-toolbar__workspace-pick')).toBeNull()
    // 勾选后：出现官方目录选择按钮，且勾选状态立即保存进模板
    await act(async () => { checkbox!.click() })
    await flushAsync(2)
    const pick = document.querySelector<HTMLButtonElement>('.wf-toolbar__workspace-pick')
    expect(pick).toBeTruthy()
    expect(pick!.textContent).toBe(zh.pickWorkspace)
    expect(pick!.disabled).toBe(false)
    const put = calls.find((call) => call.endpoint === EP.EP_PUT_FLOW_TEMPLATE)
    expect(put).toBeTruthy()
    expect((put?.args.template as WorkflowTemplate).startNewSession).toBe(true)
    // 创建实例 → 实例态：复选框消失
    await clickToolbar(zh.createInstance)
    expect(document.querySelector('.wf-toolbar__switch')).toBeNull()
  })

  it('打开模板恢复持久化的勾选与路径：创建实例先建主会话并携带工作区', async () => {
    const { remote, calls } = wsRemoteStub({
      flowTemplates: [makeTemplate({ startNewSession: true, workspacePath: 'D:\\work\\project' })],
      newSessionId: 'session-new-1',
    })
    await renderStudio(remote, pickerReturning(null))
    await openTemplate()

    // 模板级配置：打开即恢复勾选与路径（无需再选择）
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type=checkbox]')
    expect(checkbox!.checked).toBe(true)
    expect(document.querySelector('.wf-toolbar__workspace-path')?.textContent).toBe('D:\\work\\project')

    await clickToolbar(zh.createInstance)
    const sessionCall = calls.find((call) => call.endpoint === EP.EP_CREATE_SESSION)
    expect(sessionCall).toBeTruthy()
    expect(sessionCall?.args.sessionId).toBe('s-1')
    expect(sessionCall?.args.workspacePath).toBe('D:\\work\\project')
    // label 已退役：请求体只携带会话与工作区（宿主会话标题不由客户端定义）
    expect(sessionCall?.args).not.toHaveProperty('label')
    const put = calls.find((call) => call.endpoint === EP.EP_PUT_WORKFLOW)
    expect(put).toBeTruthy()
    expect(put?.args.sessionId).toBe('session-new-1')
    // 实例态：按钮变「保存实例」且复选框消失
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-toolbar button'))
      .map((item) => item.textContent)).toContain(zh.saveInstance)
    expect(document.querySelector('.wf-toolbar__switch')).toBeNull()
  })

  it('官方目录选择器选择路径：保存进模板并在按钮右侧显示；创建实例携带该路径', async () => {
    const { remote, calls } = wsRemoteStub({ flowTemplates: [makeTemplate()], newSessionId: 'session-new-1' })
    await renderStudio(remote, pickerReturning('D:\\work\\chosen'))
    await openTemplate()

    // 勾选（保存模板一次）→ 点击选择工作区（保存模板第二次，带路径）
    const checkbox = document.querySelector<HTMLInputElement>('.wf-toolbar__switch input[type=checkbox]')
    await act(async () => { checkbox!.click() })
    await flushAsync(2)
    const pick = document.querySelector<HTMLButtonElement>('.wf-toolbar__workspace-pick')
    await act(async () => { pick!.click() })
    await flushAsync(2)

    const templatePuts = calls.filter((call) => call.endpoint === EP.EP_PUT_FLOW_TEMPLATE)
    expect(templatePuts.length).toBeGreaterThanOrEqual(2)
    expect((templatePuts.at(-1)?.args.template as WorkflowTemplate).workspacePath).toBe('D:\\work\\chosen')
    // 路径显示在按钮右侧（用于确认）
    expect(document.querySelector('.wf-toolbar__workspace-path')?.textContent).toBe('D:\\work\\chosen')

    // 创建实例：新会话携带所选择的模板工作区
    await clickToolbar(zh.createInstance)
    const sessionCall = calls.find((call) => call.endpoint === EP.EP_CREATE_SESSION)
    expect(sessionCall?.args.workspacePath).toBe('D:\\work\\chosen')
  })

  it('模板态创建实例（当前会话已有实例）→ 弹覆盖确认；确认后复用旧实例 id 保存', async () => {
    const existing = makeInstance('wf-existing', 's-1', '旧实例')
    const { remote, calls } = wsRemoteStub({ workflows: [existing], flowTemplates: [makeTemplate()] })
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
    await flushAsync(2)
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

  it('实例列表 = 全部会话实例；当前主会话实例带「当前」标签，其他会话实例不带', async () => {
    const instances = [
      makeInstance('wf-current', 's-1', '当前会话实例'),
      makeInstance('wf-other', 'session-other', '其他会话实例'),
    ]
    const { remote } = wsRemoteStub({ workflows: instances })
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

