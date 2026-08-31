// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/scheduler-manager.test.tsx
//
// 定时任务管理弹层：列表加载（含运行态）/ 选择任务回填表单 / 新建草稿 /
// 保存（schedulerTaskPut 参数正确 + 校验提示）/ 删除二次确认（schedulerTaskDelete）/
// 工作流选择器仅展示模式一模板。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { SchedulerManager } from '../../src/client/components/scheduler/SchedulerManager.js'
import { zh } from '../../src/client/i18n.js'
import { EP } from '../../src/client/lib/remote.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import type { ScheduledTask, ScheduledTaskView } from '../../src/host/shared/types.js'

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

function makeTask(id: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    taskId: id,
    name: '数据抓取',
    workflowTemplateId: 'tpl-1',
    sessionMode: 'new-session',
    ownerSessionId: 's-1',
    enabled: true,
    timezone: 'Asia/Shanghai',
    window: { startDate: '2026-09-01', endDate: '2026-09-30', daysOfWeek: [], timeRanges: [{ start: '09:00', end: '18:00' }] },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['09:00'] },
    intervalConfig: { intervalMinutes: 120, startFrom: '09:00' },
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeView(task: ScheduledTask, overrides: Partial<ScheduledTaskView['runtime']> = {}): ScheduledTaskView {
  return {
    task,
    runtime: {
      status: 'idle',
      nextTriggerAt: null,
      currentSessionId: null,
      currentFlowId: null,
      currentRunId: null,
      lastTriggeredAt: null,
      lastResult: null,
      lastError: '',
      ...overrides,
    },
  }
}

interface RemoteState {
  views: ScheduledTaskView[]
  templates: Array<{ id: string; name: string; mode: string }>
  saved: Record<string, unknown> | null
  deleted: string | null
}

function makeRemote(initial: Partial<RemoteState> = {}): { remote: RemoteFace; state: RemoteState } {
  const state: RemoteState = {
    views: initial.views ?? [makeView(makeTask('task-1'))],
    templates: initial.templates ?? [
      { id: 'tpl-1', name: '数据抓取模板', mode: 'mode1' },
      { id: 'tpl-2', name: '服务模板（模式二）', mode: 'mode2' },
    ],
    saved: null,
    deleted: null,
  }
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      if (endpoint === EP.EP_SCHEDULER_TASKS) return state.views
      if (endpoint === EP.EP_LIST_FLOW_TEMPLATES) return state.templates
      if (endpoint === EP.EP_SCHEDULER_TASK_PUT) {
        state.saved = (args as Record<string, unknown>) ?? {}
        return (args as { task: ScheduledTask }).task
      }
      if (endpoint === EP.EP_SCHEDULER_TASK_DELETE) {
        state.deleted = String((args as { taskId?: string })?.taskId ?? '')
        state.views = state.views.filter((view) => view.task.taskId !== state.deleted)
        return { deleted: true }
      }
      return {}
    }),
  }
  return { remote, state }
}

async function setInput(selector: string, value: string): Promise<void> {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function waitFor(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (fn()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  expect(fn()).toBe(true)
}

describe('SchedulerManager', () => {
  it('加载任务列表 + 模式一模板（模式二模板被过滤）', async () => {
    const { remote } = makeRemote()
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(SchedulerManager, {
        copy: zh, remote, sessionId: 's-1', onClose: vi.fn(), onToast: vi.fn(),
      }))
    })
    await waitFor(() => document.querySelectorAll('.wf-combo-item').length === 1)
    const options = Array.from(document.querySelectorAll<HTMLSelectElement>('select')[0].querySelectorAll('option'))
    expect(options.map((item) => item.textContent)).toEqual(expect.arrayContaining(['数据抓取模板']))
    expect(options.map((item) => item.textContent)).not.toContain('服务模板（模式二）')
    // 选中任务回填表单
    const nameInput = document.querySelector<HTMLInputElement>('input[placeholder="任务名称"]')
    expect(nameInput?.value).toBe('数据抓取')
  })

  it('新建任务 → 编辑 → 保存：schedulerTaskPut 携带草稿', async () => {
    const { remote, state } = makeRemote()
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(SchedulerManager, {
        copy: zh, remote, sessionId: 's-1', onClose: vi.fn(), onToast: vi.fn(),
      }))
    })
    await waitFor(() => document.querySelectorAll('.wf-combo-item').length === 1)
    // 新建
    await act(async () => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent?.includes('新建任务'))
      button?.click()
    })
    const nameInput = document.querySelector<HTMLInputElement>('input[placeholder="任务名称"]')
    await setInput('input[placeholder="任务名称"]', '夜间归档')
    // 选择模板（第一个 select）
    await act(async () => {
      const select = document.querySelectorAll<HTMLSelectElement>('select')[0]
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'tpl-1')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // 保存
    await act(async () => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent === '保存')
      button?.click()
    })
    expect(state.saved).not.toBe(null)
    const task = (state.saved as { task: ScheduledTask }).task
    expect(task.name).toBe('夜间归档')
    expect(task.workflowTemplateId).toBe('tpl-1')
    expect(task.ownerSessionId).toBe('s-1')
    expect(task.taskId).toMatch(/^task-/)
  })

  it('删除需二次确认，确认后调用 schedulerTaskDelete', async () => {
    const { remote, state } = makeRemote()
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(SchedulerManager, {
        copy: zh, remote, sessionId: 's-1', onClose: vi.fn(), onToast: vi.fn(),
      }))
    })
    await waitFor(() => document.querySelectorAll('.wf-combo-item').length === 1)
    const clickButton = async (text: string): Promise<void> => {
      await act(async () => {
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
          .find((item) => item.textContent === text)
        button?.click()
      })
    }
    await clickButton('删除任务')
    expect(state.deleted).toBe(null)
    await clickButton('确认删除')
    expect(state.deleted).toBe('task-1')
    await waitFor(() => document.querySelectorAll('.wf-combo-item').length === 0)
  })

  it('表单校验：未填名称时提示且不发起保存', async () => {
    const { remote, state } = makeRemote({ views: [] })
    const onToast = vi.fn()
    await act(async () => {
      root = createRoot(container!)
      root.render(React.createElement(SchedulerManager, {
        copy: zh, remote, sessionId: 's-1', onClose: vi.fn(), onToast,
      }))
    })
    await waitFor(() => document.querySelector('.wf-combo__side-list') !== null)
    await act(async () => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent?.includes('新建任务'))
      button?.click()
    })
    await act(async () => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((item) => item.textContent === '保存')
      button?.click()
    })
    expect(onToast).toHaveBeenCalled()
    expect(state.saved).toBe(null)
  })
})
