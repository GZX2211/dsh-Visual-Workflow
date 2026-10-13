// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/confirm-dialog/ConfirmDialog.test.tsx
//
// 确认弹层三形态的渲染与动作接线（D07-16 补缺：此前 importOverwrite/importRename
// 在所有测试里零命中，导入冲突形态只有 hook 层 dispatch 断言，没人验证它真的渲染出
// 「覆盖/改名/取消」三个动作）。
// 断言用户可见结果：标题/正文/按钮文案与顺序、点击触发的回调归属、以及三分支互不串档。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmDialog } from '../../../../src/client/components/confirm-dialog/ConfirmDialog.js'
import { zh } from '../../../../src/client/i18n.js'
import type { ConfirmState } from '../../../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

interface Handlers {
  onClose: ReturnType<typeof vi.fn<() => void>>
  onSaveAndProceed: ReturnType<typeof vi.fn<() => void>>
  onDiscardAndProceed: ReturnType<typeof vi.fn<() => void>>
  onResolveImport: ReturnType<typeof vi.fn<(mode: string) => void>>
}

function render(confirm: ConfirmState | null): Handlers {
  const handlers: Handlers = {
    onClose: vi.fn<() => void>(),
    onSaveAndProceed: vi.fn<() => void>(),
    onDiscardAndProceed: vi.fn<() => void>(),
    onResolveImport: vi.fn<(mode: string) => void>(),
  }
  act(() => {
    root = createRoot(container!)
    root.render(
      <ConfirmDialog
        confirm={confirm}
        copy={zh}
        onClose={handlers.onClose}
        onSaveAndProceed={handlers.onSaveAndProceed}
        onDiscardAndProceed={handlers.onDiscardAndProceed}
        onResolveImport={handlers.onResolveImport}
      />,
    )
  })
  return handlers
}

function dialog(): HTMLElement | null {
  return container!.querySelector<HTMLElement>('[role="dialog"]')
}

/** 弹层正文（用户看到的标题与说明文本）。 */
function texts(): string[] {
  return [...container!.querySelectorAll('.wf-confirm h3, .wf-confirm p')].map((el) => el.textContent ?? '')
}

function actionButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>('.wf-confirm__actions button')]
}

describe('ConfirmDialog 形态：不显示', () => {
  it('confirm 为 null → 不渲染弹层', () => {
    render(null)
    expect(dialog()).toBeNull()
    expect(container!.textContent).toBe('')
  })
})

describe('ConfirmDialog 形态：importConflict（导入冲突）', () => {
  const conflict: ConfirmState = {
    kind: 'importConflict',
    kind2: 'workflow',
    name: '同名工作流',
    json: '{"id":"x"}',
    message: zh.importConflictMessage.replace('{name}', '同名工作流'),
  }

  it('渲染冲突标题 + 已存在名称说明 + 「覆盖/改名/取消」三个动作（顺序与语义类）', () => {
    render(conflict)

    expect(dialog()).not.toBeNull()
    // 弹层可访问名 = 标题，读屏据此播报
    expect(dialog()!.getAttribute('aria-label')).toBe(zh.importConflictTitle)
    expect(texts()).toEqual([zh.importConflictTitle, zh.importConflictMessage.replace('{name}', '同名工作流')])

    const buttons = actionButtons()
    expect(buttons.map((button) => button.textContent)).toEqual([zh.importOverwrite, zh.importRename, zh.importCancel])
    // 破坏性动作（覆盖）用危险样式；改名与取消为普通样式
    expect(buttons[0].classList.contains('is-danger')).toBe(true)
    expect(buttons[1].classList.contains('is-danger')).toBe(false)
    expect(buttons[2].classList.contains('is-danger')).toBe(false)
    // 不得串档成其它形态的动作（保存/放弃/删除）
    expect(buttons.some((button) => button.textContent === zh.unsavedSave)).toBe(false)
    expect(buttons.some((button) => button.textContent === zh.inspectorDelete)).toBe(false)
  })

  it('动作接线：覆盖/改名各以对应模式调 onResolveImport，取消走 onClose', () => {
    const h = render(conflict)
    const [overwrite, rename, cancel] = actionButtons()

    act(() => { overwrite.click() })
    expect(h.onResolveImport).toHaveBeenLastCalledWith('overwrite')
    expect(h.onClose).not.toHaveBeenCalled()

    act(() => { rename.click() })
    expect(h.onResolveImport).toHaveBeenLastCalledWith('rename')
    expect(h.onResolveImport).toHaveBeenCalledTimes(2)
    expect(h.onClose).not.toHaveBeenCalled()

    act(() => { cancel.click() })
    expect(h.onClose).toHaveBeenCalledTimes(1)
    // 取消不是「解决冲突」：不得顺手按某个模式导入
    expect(h.onResolveImport).toHaveBeenCalledTimes(2)
  })

  it('message 缺失时不借用其它形态文案（渲染空正文而非 unsaved/删除提示）', () => {
    render({ kind: 'importConflict', name: 'X' })

    expect(texts()).toEqual([zh.importConflictTitle, ''])
    expect(container!.textContent).not.toContain(zh.unsavedMessage)
    expect(container!.textContent).not.toContain(zh.inspectorDelete)
  })
})

describe('ConfirmDialog 形态：confirmText（对照，确认通用语义）', () => {
  it('标题/按钮取入参文案；确认先关闭再执行回调', () => {
    const order: string[] = []
    const onConfirm = vi.fn(() => { order.push('confirm') })
    const h = render({
      kind: 'confirmText',
      title: '覆盖已有实例',
      message: '新运行将覆盖旧实例',
      confirmLabel: '覆盖',
      onConfirm,
    })
    h.onClose.mockImplementation(() => { order.push('close') })

    expect(texts()).toEqual(['覆盖已有实例', '新运行将覆盖旧实例'])
    expect(actionButtons().map((button) => button.textContent)).toEqual(['覆盖', zh.unsavedCancel])

    act(() => { actionButtons()[0].click() })
    // 先关闭弹层再执行确认动作（避免确认回调里再次打开/替换弹层时被关闭覆盖）
    expect(order).toEqual(['close', 'confirm'])
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('未给 title/confirmLabel 时回落到词典缺省文案', () => {
    render({ kind: 'confirmText' })
    expect(texts()[0]).toBe(zh.confirmDelete)
    expect(actionButtons()[0].textContent).toBe(zh.inspectorDelete)
  })
})

describe('ConfirmDialog 形态：unsaved（对照，未保存守卫三选项）', () => {
  it('三选项分别接 onSaveAndProceed / onDiscardAndProceed / onClose，且不触碰导入回调', () => {
    const h = render({ kind: 'unsaved', proceed: vi.fn() })

    expect(texts()).toEqual([zh.unsavedTitle, zh.unsavedMessage])
    const buttons = actionButtons()
    expect(buttons.map((button) => button.textContent)).toEqual([zh.unsavedSave, zh.unsavedDiscard, zh.unsavedCancel])

    act(() => { buttons[0].click() })
    act(() => { buttons[1].click() })
    act(() => { buttons[2].click() })
    expect(h.onSaveAndProceed).toHaveBeenCalledTimes(1)
    expect(h.onDiscardAndProceed).toHaveBeenCalledTimes(1)
    expect(h.onClose).toHaveBeenCalledTimes(1)
    expect(h.onResolveImport).not.toHaveBeenCalled()
  })
})
