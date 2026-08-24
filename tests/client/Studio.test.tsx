// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

//
// tests/client/Studio.test.tsx
//
// Studio 单测（T-042）：会话绑定（无下拉）、初始数据加载（工作流/模板/服务）、
// 工作流列表打开画布、新建草稿、运行/保存按钮可用性。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Studio } from '../../src/client/studio/Studio.js'
import { zh } from '../../src/client/i18n.js'
import type { RemoteFace } from '../../src/client/hooks/useRemote.js'
import type { WorkflowDocument } from '../../src/host/shared/graph-model.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  localStorage.clear()
  document.body.innerHTML = ''
})

function mount(node: React.ReactElement): void {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => { root.unmount() })
  act(() => { root.render(node) })
}

/** 端点分发的 fake remote。 */
function makeRemote(workflows: WorkflowDocument[] = []): { remote: RemoteFace; calls: string[] } {
  const calls: string[] = []
  const remote: RemoteFace = {
    call: vi.fn(async (endpoint: string) => {
      calls.push(endpoint)
      if (endpoint === 'listWorkflows') return workflows
      if (endpoint === 'listTemplates') return []
      if (endpoint === 'listServices') return []
      if (endpoint === 'presets' || endpoint === 'tools' || endpoint === 'models' || endpoint === 'toolCombos') return []
      return null
    }),
  }
  return { remote, calls }
}

function makeFlow(id: string, name: string): WorkflowDocument {
  return {
    id,
    sessionId: 'session-1',
    mode: 'mode1',
    name,
    description: '',
    revision: 1,
    nodes: [
      { id: `${id}-start`, kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
      { id: `${id}-end`, kind: 'end', position: { x: 200, y: 0 }, data: { label: '结束' } },
    ],
    lines: [],
  }
}

describe('Studio 骨架与数据加载', () => {
  it('会话绑定：标题栏显示当前会话（无会话下拉）', async () => {
    const { remote } = makeRemote()
    mount(<Studio t={zh} sessionId="session-42" remote={remote} />)
    await act(async () => {})
    expect(document.querySelector('.wf-titlebar__session')?.textContent).toBe(zh.currentSession)
    expect(document.querySelectorAll('.wf-titlebar__session')).toHaveLength(1)
    // 无会话下拉控件
    expect(document.querySelector('select')).toBeNull()
  })

  it('初始加载：工作流列表渲染 + 四 Tab 头', async () => {
    const { remote, calls } = makeRemote([makeFlow('wf-1', '流程A'), makeFlow('wf-2', '流程B')])
    mount(<Studio t={zh} sessionId="session-1" remote={remote} />)
    await act(async () => {})
    expect(calls).toContain('listWorkflows')
    expect(calls).toContain('listTemplates')
    expect(calls).toContain('listServices')
    const items = [...document.querySelectorAll('.wf-lib-item__name')].map((el) => el.textContent)
    expect(items).toEqual(['流程A', '流程B'])
    const tabs = [...document.querySelectorAll('.wf-lib-tab')].map((el) => el.textContent)
    expect(tabs).toContain(zh.libTab.workflow)
    expect(tabs).toContain(zh.libTab.role)
    expect(tabs).toContain(zh.libTab.database)
  })

  it('点击工作流：打开画布（工具栏显示流程名 + 运行/保存可用）', async () => {
    const { remote } = makeRemote([makeFlow('wf-1', '流程A')])
    mount(<Studio t={zh} sessionId="session-1" remote={remote} />)
    await act(async () => {})
    const saveBefore = (document.querySelector('.wf-canvas-toolbar .wf-btn') as HTMLButtonElement)
    expect(saveBefore.disabled).toBe(true)
    await act(async () => {
      (document.querySelector('.wf-lib-item') as HTMLButtonElement).click()
    })
    expect(document.querySelector('.wf-canvas-toolbar__flow')?.textContent).toBe('流程A')
    const run = (document.querySelector('.wf-canvas-toolbar .wf-btn') as HTMLButtonElement)
    expect(run.disabled).toBe(false)
  })

  it('新建工作流：列表增加草稿并打开', async () => {
    const { remote } = makeRemote()
    mount(<Studio t={zh} sessionId="session-1" remote={remote} />)
    await act(async () => {})
    expect(document.querySelectorAll('.wf-lib-item')).toHaveLength(0)
    await act(async () => {
      (document.querySelector('.wf-lib-tab__add') as HTMLButtonElement).click()
    })
    expect(document.querySelectorAll('.wf-lib-item')).toHaveLength(1)
    // 草稿已打开（画布区显示其名称）
    expect(document.querySelector('.wf-canvas-toolbar__flow')?.textContent).toContain(zh.newWorkflow)
  })

  it('模式 Tab 切换：显示对应空态', async () => {
    const { remote } = makeRemote()
    mount(<Studio t={zh} sessionId="session-1" remote={remote} />)
    await act(async () => {})
    const roleTab = [...document.querySelectorAll('.wf-lib-tab')].find((el) => el.textContent === zh.libTab.role) as HTMLButtonElement
    await act(async () => { roleTab.click() })
    expect(document.querySelector('.wf-lib-empty')?.textContent).toBe(zh.libRoleEmpty)
  })

  it('空会话：画布空态提示', async () => {
    const { remote } = makeRemote()
    mount(<Studio t={zh} sessionId="session-1" remote={remote} />)
    await act(async () => {})
    expect(document.querySelector('.wf-canvas-empty')?.textContent).toContain(zh.canvasEmpty)
    expect(document.querySelector('.wf-inspector__empty')?.textContent).toBe(zh.inspectorEmpty)
  })
})
