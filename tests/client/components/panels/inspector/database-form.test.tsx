// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/database-form.test.tsx
//
// 数据库表单高级选项：非空默认值回显、可折叠分组、向量检索参数写回。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { DatabaseForm } from '../../../../../src/client/components/panels/inspector/database-form.js'
import { zh } from '../../../../../src/client/i18n.js'

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
})

function makeDbFormData(): Record<string, unknown> {
  return { label: '库', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '/x.db' }
}

async function renderDatabaseForm(onPatch: (patch: Record<string, unknown>) => void = () => {}): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(DatabaseForm, {
      data: makeDbFormData(),
      copy: zh,
      onPatch,
      onTest: () => {},
    } as Parameters<typeof DatabaseForm>[0]))
  })
}

describe('数据库表单高级选项', () => {
  it('渲染高级选项：可折叠 details、非空默认值、底部注释（显示正确）', async () => {
    await renderDatabaseForm()
    const text = container!.textContent ?? ''
    const details = container!.querySelector<HTMLDetailsElement>('details.wf-advanced')
    expect(details).toBeTruthy()
    expect(details!.querySelector('summary')?.textContent).toBe(zh.dbAdvanced)
    // 非空默认值：未配置时也回显（不能留白）
    const nums = Array.from(container!.querySelectorAll<HTMLInputElement>('input[type="number"]')).map((i) => i.value)
    expect(nums).toContain('5')
    expect(nums).toContain('0')
    expect(nums).toContain('128')
    expect(nums).toContain('384')
    expect(nums).toContain('10000')
    // 底部简短作用注释
    expect(text).toContain('召回条数=')
  })

  it('修改召回条数 → onPatch 写入 vectorOptions 对象（数据传递正确）', async () => {
    let patch: Record<string, unknown> | null = null
    await renderDatabaseForm((p) => { patch = p })
    const topKInput = container!.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(topKInput, '8')
      topKInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(patch).toEqual({ vectorOptions: { topK: 8 } })
  })
})
