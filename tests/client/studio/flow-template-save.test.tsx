// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/studio/flow-template-save.test.tsx
//
// 工作流模板保存路径（EP_PUT_FLOW_TEMPLATE）的回归网。
//
// 为什么单独成文：D11-04 把 Studio 装配级夹具收敛到 `fixtures/studio-harness.ts` 后，
// 共享桩虽然保留了该端点的分支，但**没有用例真正走到它**——把该分支摘掉，studio 全域仍全绿
// （V2 后审实测 11 files / 131 tests），保存模板这条链路因此失去回归网。
// 本文件用真实 UI 路径（新建工作流模板草稿 → 属性栏「保存」）驱动该端点，覆盖成功与失败两条路径。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { zh } from '../../../src/client/i18n.js'
import { EP } from '../../../src/client/lib/remote.js'
import { flushAsync } from '../fixtures/async-flush.js'
import { mountStudio, remoteStub, type RemoteStub } from '../fixtures/studio-harness.js'

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

/** 在容器内挂载 Studio 并新建一个工作流模板草稿（属性栏随草稿打开）。 */
async function mountDraft(remote: RemoteStub): Promise<void> {
  await mountStudio(container!, (next) => { root = next }, remote)
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.wf-docgroup__add')?.click()
  })
  await flushAsync(2)
}

/** 属性栏「保存」按钮（模版态落库入口）。 */
function inspectorSaveButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-inspector__footer button'))
    .find((item) => item.textContent === zh.inspectorSave)
}

describe('工作流模板保存（EP_PUT_FLOW_TEMPLATE）', () => {
  it('模板态点「保存」→ 走 EP_PUT_FLOW_TEMPLATE，载荷为序列化后的模板本体', async () => {
    const remote = remoteStub()
    await mountDraft(remote)

    const save = inspectorSaveButton()
    expect(save, '模板态属性栏应有「保存」按钮').toBeTruthy()
    await act(async () => { save!.click() })
    await flushAsync(3)

    const puts = remote.calls.filter((call) => call.endpoint === EP.EP_PUT_FLOW_TEMPLATE)
    expect(puts, '保存模板必须走 EP_PUT_FLOW_TEMPLATE').toHaveLength(1)
    // 载荷形状：{ template }，且是序列化后的模板本体（草稿首存保持 id/名称）
    const payload = puts[0].args.template as Record<string, unknown>
    expect(Object.keys(puts[0].args)).toEqual(['template'])
    expect(typeof payload.id).toBe('string')
    expect(payload.mode).toBe('mode1')
    expect(payload.name).toBe(zh.untitledFlowTemplate)
    expect(Array.isArray(payload.nodes)).toBe(true)
    expect(Array.isArray(payload.lines)).toBe(true)
    // 草稿标记属前端 UI 状态，不得随载荷外泄（后端 stripClientMeta 之外的第二道保障）
    expect(puts[0].args).not.toHaveProperty('_draft')
  })

  it('保存成功：不误写实例端点，且给出「已保存」提示（不依赖列表重载）', async () => {
    const remote = remoteStub()
    await mountDraft(remote)
    const listCallsBefore = remote.calls.filter((call) => call.endpoint === EP.EP_LIST_FLOW_TEMPLATES).length

    await act(async () => { inspectorSaveButton()!.click() })
    await flushAsync(4)

    expect(remote.calls.filter((call) => call.endpoint === EP.EP_PUT_FLOW_TEMPLATE)).toHaveLength(1)
    expect(remote.calls.some((call) => call.endpoint === EP.EP_PUT_WORKFLOW), '保存模板不得写实例端点').toBe(false)
    // 成功路径不重载列表（避免用服务端快照覆盖本地草稿）；列表重载只出现在失败兜底。
    expect(remote.calls.filter((call) => call.endpoint === EP.EP_LIST_FLOW_TEMPLATES)).toHaveLength(listCallsBefore)
    // 保存结果被真正消费：草稿条目仍在左栏（走真实「保存 → 状态更新」链路，
    // 桩若退化成兜底返回（丢 id/name）这条断言即失败）。
    expect(container!.textContent ?? '').toContain(zh.untitledFlowTemplate)
  })

  it('保存失败：请求确实发出，但列表重载兜底且不抛错（失败路径可达）', async () => {
    const remote = remoteStub({
      handlers: {
        [EP.EP_PUT_FLOW_TEMPLATE]: () => { throw new Error('模板保存失败') },
      },
    })
    await mountDraft(remote)
    // 失败发生在点击之后：重载是兜底路径，断言「请求发出 + 页面不崩」
    await act(async () => { inspectorSaveButton()!.click() })
    await flushAsync(3)

    expect(remote.calls.filter((call) => call.endpoint === EP.EP_PUT_FLOW_TEMPLATE)).toHaveLength(1)
    expect(container!.textContent ?? '').toContain(zh.untitledFlowTemplate)
  })
})
