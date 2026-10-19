// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/text-expand-layout.test.tsx
//
// 文本扩展的布局级行为（用户批注）：
//   - 展开层渲染在画布容器内：左边界随左栏/底栏切换自动变化，右边界止于属性栏；
//   - 顶部控制栏不被遮挡（展开层挂在工具栏之下——以 DOM 归属与样式类锁定）；
//   - 编辑扩展文本写回属性栏同一字段，收起按钮返回；
//   - 切换编辑对象/点击画布空白时自动收起（避免旧字段写进新对象）；
//   - 资产界面（角色资产）同样具备扩展能力。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { zh } from '../../../src/client/i18n.js'
import { EP } from '../../../src/client/lib/remote.js'
import { flushAsync } from '../fixtures/async-flush.js'
import { libTab, mountStudio, pointerClick, remoteStub } from '../fixtures/studio-harness.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  localStorage.clear()
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
})

async function renderStudio(remote = remoteStub()): Promise<void> {
  await mountStudio(container!, (next) => { root = next }, remote, { flushBoot: true })
  await flushAsync(2)
}

/** 打开角色模板「研究员」的属性栏。 */
async function openRoleTemplate(): Promise<void> {
  await act(async () => { libTab(zh.libTab.role)?.click() })
  const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem'))
    .find((item) => item.textContent?.includes('研究员'))
  expect(card).toBeTruthy()
  await act(async () => { pointerClick(card!) })
}

/** 属性栏里 System Prompt 文本域（按占位文案定位，避免依赖字段顺序）。 */
function personaTextarea(): HTMLTextAreaElement {
  const field = document.querySelector<HTMLTextAreaElement>(`.wf-inspector textarea[placeholder="${zh.personaHint}"]`)
  expect(field).toBeTruthy()
  return field!
}

/** 受控 textarea 输入（React 受控输入必须走原型 setter 再派发 input 事件）。 */
function typeInto(input: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!
  descriptor.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 点击属性栏里 System Prompt 字段的展开按钮。 */
async function openPersonaExpander(): Promise<void> {
  const expand = document.querySelector<HTMLButtonElement>('.wf-inspector .wf-textarea__expand')
  expect(expand).toBeTruthy()
  await act(async () => { expand!.click() })
}

describe('文本扩展：布局与编辑（角色模板）', () => {
  it('展开层挂在画布容器内（不遮挡属性栏），编辑写回属性栏同一字段，收起按钮返回', async () => {
    await renderStudio()
    await openRoleTemplate()
    const field = personaTextarea()

    await openPersonaExpander()
    // 位置语义：扩展层是画布容器的后代，不是属性栏的后代；
    // 顶部控制栏在画布容器之外/之上，扩展层以 top:52px 从其下方开始（见样式类）。
    const overlay = document.querySelector('.wf-text-expand')
    expect(overlay).toBeTruthy()
    expect(overlay!.closest('.wf-canvas-shell')).not.toBeNull()
    expect(overlay!.closest('.wf-inspector')).toBeNull()

    const big = overlay!.querySelector<HTMLTextAreaElement>('.wf-text-expand__input')!
    expect(big.value).toBe(field.value)

    await act(async () => { typeInto(big, '扩展后写入的系统提示词') })
    expect(personaTextarea().value).toBe('扩展后写入的系统提示词')

    await act(async () => {
      overlay!.querySelector<HTMLButtonElement>('.wf-text-expand__collapse')!.click()
    })
    expect(document.querySelector('.wf-text-expand')).toBeNull()
  })

  it('切换左侧栏/底栏后扩展层仍在画布容器内（铺满调整后的中间画布）', async () => {
    await renderStudio()
    await openRoleTemplate()
    await openPersonaExpander()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.wf-toolbar__panels')!.click()
    })

    // 左栏 → 底栏：画布容器仍存在，扩展层仍归属于它（几何由 flex 布局带动）
    expect(document.querySelector('.wf-bottombar')).toBeTruthy()
    expect(document.querySelector('.wf-canvas-shell .wf-text-expand')).toBeTruthy()
  })

  it('切换编辑对象（点击画布空白）时自动收起扩展层', async () => {
    await renderStudio()
    await openRoleTemplate()
    await openPersonaExpander()
    expect(document.querySelector('.wf-text-expand')).toBeTruthy()

    await act(async () => {
      document.querySelector<HTMLElement>('.wf-canvas')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.querySelector('.wf-text-expand')).toBeNull()
  })
})

describe('文本扩展：资产界面同样适用', () => {
  /** 资产感知的假远端：角色资产可打开到属性栏。 */
  function assetRemoteStub() {
    const roleDetail = {
      assetId: 'a-r1',
      versionId: 1,
      rowId: 'row-1',
      kind: 'agent',
      roleAssetType: 'standalone',
      name: '资产角色',
      systemPrompt: '资产角色的提示词',
      provider: 'deepseek',
      model: 'deepseek-chat',
      retryLimit: 3,
      referenceWorkflowIds: [],
      createdAt: 1,
    }
    return remoteStub({
      handlers: {
        [EP.EP_LIST_ASSETS]: () => ({
          workflows: [],
          roles: [{ assetId: 'a-r1', versionId: 1, name: '资产角色', kind: 'agent', roleAssetType: 'standalone', updatedAt: 1 }],
        }),
        [EP.EP_GET_ASSET]: () => roleDetail,
      },
    })
  }

  it('角色资产属性栏的文本域可展开到画布区域', async () => {
    await renderStudio(assetRemoteStub())
    // 切到资产来源 → 角色 Tag → 打开角色资产
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-source__tab'))
        .find((item) => item.textContent === zh.libSourceAsset)?.click()
    })
    await flushAsync(2)
    await act(async () => { libTab(zh.libTab.role)?.click() })
    const card = Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-docitem'))
      .find((item) => item.textContent?.includes('资产角色'))
    expect(card).toBeTruthy()
    await act(async () => { pointerClick(card!) })
    await flushAsync(2)

    expect(document.querySelector('.wf-inspector .wf-textarea__expand')).toBeTruthy()
    await openPersonaExpander()
    expect(document.querySelector('.wf-canvas-shell .wf-text-expand')).toBeTruthy()
  })
})
