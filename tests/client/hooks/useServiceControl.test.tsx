// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useServiceControl.test.tsx
//
// 模式二服务控制面的写路径形状守卫（D08-09）：saveService / startService / stopService
// 在远端返回「无字符串 id」时一律视为失败——不 dispatch 半截对象，抛出可行动错误
// 由调用方 toast（本 hook 无词典注入，不产出面向用户的文案）。
// 为什么必须守住：半截对象写进状态机后，下游按 id/sessionId 取值会整片崩溃
// （与 D08-01 同一条崩溃链），且用户会看到「操作成功」后界面炸掉。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { SERVICE_STATE_SHAPE_CODE, serviceShapeTextOf, useServiceControl, type ServiceControlFace } from '../../../src/client/hooks/useServiceControl.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { CanvasEdge, CanvasNode } from '../../../src/client/lib/canvas-model.js'
import type { ServiceState } from '../../../src/host/shared/types.js'

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
  vi.restoreAllMocks()
})

/** 服务实例夹具（字段与后端 ServiceState 契约一致）。 */
function makeService(): ServiceState {
  return {
    id: 'svc-1',
    sessionId: 's-1',
    name: '服务',
    description: '',
    revision: 0,
    nodes: [],
    lines: [],
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    status: 'stopped',
  } as unknown as ServiceState
}

const nodes: CanvasNode[] = []
const edges: CanvasEdge[] = []

/** 远端原样回显给定载荷（形状漂移与否由用例决定）。 */
function makeRemote(payload: unknown): RemoteFace {
  return { call: vi.fn(async () => payload) } as unknown as RemoteFace
}

/** 渲染控制面并把 face 与 dispatch 交给用例。 */
async function renderFace(remote: RemoteFace): Promise<{ face: ServiceControlFace; dispatch: ReturnType<typeof vi.fn> }> {
  const dispatch = vi.fn()
  let face: ServiceControlFace | null = null
  function Harness(): null {
    const value = useServiceControl(dispatch, remote)
    useEffect(() => { face = value }, [value])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { face: face!, dispatch }
}

describe('useServiceControl：写路径形状守卫（无字符串 id 即失败）', () => {
  it.each([
    ['null', null],
    ['空对象', {}],
    ['id 非字符串', { id: 123 }],
    ['id 为空串', { id: '' }],
    ['非对象', 'not-an-object'],
  ])('saveService：远端返回 %s → 抛错且不 dispatch', async (_label, payload) => {
    const { face, dispatch } = await renderFace(makeRemote(payload))

    await expect(face.saveService(makeService(), nodes, edges)).rejects.toMatchObject({ code: SERVICE_STATE_SHAPE_CODE })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('startService：远端返回 null → 抛错且不 dispatch', async () => {
    const { face, dispatch } = await renderFace(makeRemote(null))

    await expect(face.startService('svc-1', 's-1')).rejects.toMatchObject({ code: SERVICE_STATE_SHAPE_CODE })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('stopService：远端返回无 id 对象 → 抛错且不 dispatch', async () => {
    const { face, dispatch } = await renderFace(makeRemote({ status: 'stopped' }))

    await expect(face.stopService('svc-1', 's-1')).rejects.toMatchObject({ code: SERVICE_STATE_SHAPE_CODE })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('saveService：远端返回合法对象 → dispatch SERVICE_UPDATED 并原样返回该对象', async () => {
    const saved = makeService()
    const { face, dispatch } = await renderFace(makeRemote(saved))

    let returned: ServiceState | null = null
    await act(async () => {
      returned = await face.saveService(makeService(), nodes, edges)
    })

    expect(dispatch).toHaveBeenCalledWith({ type: 'SERVICE_UPDATED', service: saved })
    expect(returned).toBe(saved)
  })

  it('startService / stopService：远端返回合法对象 → 各自 dispatch SERVICE_UPDATED', async () => {
    const started = makeService()
    const { face, dispatch } = await renderFace(makeRemote(started))

    await act(async () => {
      await face.startService('svc-1', 's-1')
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SERVICE_UPDATED', service: started })

    dispatch.mockClear()
    await act(async () => {
      await face.stopService('svc-1', 's-1')
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SERVICE_UPDATED', service: started })
  })
})

// ---------------------------------------------------------------------------
// 形状失败文案的词典映射：hook 只给稳定码，界面语言由调用方映射
// ---------------------------------------------------------------------------

describe('serviceShapeTextOf：按稳定码换词典文案', () => {
  it('码匹配 → 换成给定文案并保留 code（调用方仍可按码分支）', () => {
    const error = Object.assign(new Error('Invalid service state from host'), { code: SERVICE_STATE_SHAPE_CODE })
    const localized = serviceShapeTextOf(error, '宿主返回的服务状态不完整') as Error & { code?: string }
    expect(localized).toBeInstanceOf(Error)
    expect(localized.message).toBe('宿主返回的服务状态不完整')
    expect(localized.code).toBe(SERVICE_STATE_SHAPE_CODE)
    // 原错误不被就地改写（调用方可能仍要用它记日志）
    expect(error.message).toBe('Invalid service state from host')
  })

  it('其它错误原样透传（不吞错、不改写）', () => {
    const other = new Error('boom')
    expect(serviceShapeTextOf(other, '不该出现')).toBe(other)
    expect(serviceShapeTextOf(null, '不该出现')).toBeNull()
    expect(serviceShapeTextOf({ code: 'WF_OTHER' }, '不该出现')).toEqual({ code: 'WF_OTHER' })
  })
})
