// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useStudioBoot.test.tsx
//
// 工作台初始化加载（hooks/useStudioBoot.ts）：
//   boot 并行拉取「实例 / 模板 / 服务」三类列表，任一来源失败都不得丢弃其余来源的结果——
//   模板端点失败时，已成功加载的实例仍必须参与「进入工作台自动选中实例」，
//   不能因为模板目录损坏就把画布留在空白态。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useStudioBoot, pickInitialInstanceForSession } from '../../../src/client/hooks/useStudioBoot.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { WorkflowsFace } from '../../../src/client/hooks/useWorkflows.js'
import type { FlowTemplatesFace } from '../../../src/client/hooks/useFlowTemplates.js'
import type { TemplatesFace } from '../../../src/client/hooks/useTemplates.js'
import type { ServiceControlFace } from '../../../src/client/hooks/useServiceControl.js'
import type { StudioAction, StudioState } from '../../../src/client/studio/studio-state.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'

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

function flowOf(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 's-1',
    mode: 'mode1',
    name: '实例一',
    description: '',
    revision: 1,
    nodes: [],
    lines: [],
    createdAt: '2026-10-01T00:00:00.000Z',
  } as unknown as WorkflowDocument
}

async function bootWith(overrides: {
  loadFlowTemplates: () => Promise<unknown>
}): Promise<{ dispatch: ReturnType<typeof vi.fn>; toastError: ReturnType<typeof vi.fn> }> {
  const dispatch = vi.fn()
  const toastError = vi.fn()
  const workflows = { loadWorkflows: vi.fn(async () => [flowOf()]) } as unknown as WorkflowsFace
  const flowTemplates = { loadFlowTemplates: vi.fn(overrides.loadFlowTemplates) } as unknown as FlowTemplatesFace
  const templates = {
    loadTemplates: vi.fn(async () => ({ role: [{ id: 'role-parent-builtin', kind: 'parent', name: '父代理' }] })),
    saveTemplate: vi.fn(async () => undefined),
  } as unknown as TemplatesFace
  const serviceControl = { loadServices: vi.fn(async () => []) } as unknown as ServiceControlFace
  const remote = {
    call: vi.fn(async () => []),
    stream: vi.fn(async () => undefined),
  } as unknown as RemoteFace
  const state = { sessionId: 's-1', mode: 'mode1' } as unknown as StudioState

  function Harness() {
    useStudioBoot(
      state,
      dispatch as unknown as React.Dispatch<StudioAction>,
      vi.fn(),
      toastError,
      remote,
      workflows,
      flowTemplates,
      templates,
      serviceControl,
      pickInitialInstanceForSession,
    )
    return null
  }

  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { dispatch, toastError }
}

describe('工作台初始化加载', () => {
  it('模板列表失败不阻断已成功加载实例的自动选中，且失败必须上报', async () => {
    const templateError = new Error('模板目录损坏')
    const { dispatch, toastError } = await bootWith({ loadFlowTemplates: async () => { throw templateError } })

    expect(dispatch).toHaveBeenCalledWith({ type: 'OPEN_FLOW', flow: flowOf() })
    expect(toastError).toHaveBeenCalledWith(templateError)
  })
})
