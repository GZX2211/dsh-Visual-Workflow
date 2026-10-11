// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/run-history/RunHistory.test.tsx
//
// 运行历史面板（components/run-history/RunHistory.tsx）：
//   ① 结构合法：交互元素不得嵌套在 <button> 内（列表项里的「恢复」按钮与「选中该 run」
//      必须是同级交互面，否则无效 HTML，且键盘/读屏只会识别外层按钮）；
//   ② 「恢复」与「选中」互不触发：点恢复只走 onResume，点列表项只走 onSelect。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { RunHistory } from '../../../../src/client/components/run-history/RunHistory.js'
import { zh } from '../../../../src/client/i18n.js'
import type { RunSnapshot } from '../../../../src/host/shared/types.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function runOf(id: string, status: string): RunSnapshot {
  return {
    id,
    sessionId: 's-1',
    flowId: 'flow-1',
    flowName: '工作流一',
    status,
    startedAt: '2026-10-01T00:00:00.000Z',
  } as unknown as RunSnapshot
}

async function renderHistory(history: RunSnapshot[], onSelect = vi.fn(), onResume = vi.fn()): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(
      React.createElement(RunHistory, {
        history,
        selectedRunId: null,
        copy: zh,
        onSelect,
        onClose: vi.fn(),
        onResume,
        canResume: true,
      }),
    )
  })
}

describe('运行历史面板', () => {
  it('交互元素不得嵌套：恢复按钮不与列表项按钮互相嵌套', async () => {
    await renderHistory([runOf('r-1', 'paused')])
    expect(container!.querySelectorAll('button button')).toHaveLength(0)
    expect(container!.querySelectorAll('.wf-history__item button').length).toBeGreaterThan(0)
  })

  it('点「恢复」只触发 onResume；点列表项主体只触发 onSelect', async () => {
    const onSelect = vi.fn()
    const onResume = vi.fn()
    await renderHistory([runOf('r-1', 'paused')], onSelect, onResume)
    const resume = container!.querySelector<HTMLButtonElement>('.wf-history__resume button')
    expect(resume?.textContent).toBe(zh.resumeRun)
    await act(async () => { resume?.click() })
    expect(onResume).toHaveBeenCalledWith('r-1')
    expect(onSelect).not.toHaveBeenCalled()

    const select = container!.querySelector<HTMLButtonElement>('.wf-history__item .wf-history__select')
    await act(async () => { select?.click() })
    expect(onSelect).toHaveBeenCalledWith('r-1')
    expect(onResume).toHaveBeenCalledTimes(1)
  })
})
