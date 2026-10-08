// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useExperiences.test.tsx
//
// useExperiences（hooks/useExperiences.ts）单测：
//   ① 四个经验端点（listExperiences / saveExperience / retireExperience / restoreExperience）
//      的调用与参数，以及列表 / 详情状态写入；
//   ② 保存载荷投影（experiencePatchOf）：只回传可编辑字段，null 表达清空；
//   ③ 错误码分支：ERR_EXPERIENCE_NOT_FOUND → 提示 + 刷新经验列表；
//   ④ 竞态与卸载：迟到的列表响应不覆盖最新一次；卸载后不再 dispatch。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { experiencePatchOf, useExperiences, type ExperiencesFace } from '../../../src/client/hooks/useExperiences.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { RemoteError } from '../../../src/client/lib/remote.js'
import { EP } from '../../../src/client/lib/remote.js'
import type { ExperienceEntry } from '../../../src/host/shared/asset-types.js'
import { createInitialState, type StudioState } from '../../../src/client/studio/studio-state.js'
import { zh } from '../../../src/client/i18n.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  // 卸载包在 act 里：宿主回调若在卸载路径上触发，也不该让测试输出被 act 警告淹没
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  vi.restoreAllMocks()
})

/** 调用记录 + 可编排响应的假远端面。 */
function makeRemote(handler: (endpoint: string, args: Record<string, unknown>) => unknown): {
  remote: RemoteFace
  calls: Array<{ endpoint: string; args: Record<string, unknown> }>
} {
  const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const remote: RemoteFace = {
    stream: vi.fn(async () => undefined),
    call: vi.fn(async (endpoint: string, args?: Record<string, unknown>) => {
      const safe = args ?? {}
      calls.push({ endpoint, args: safe })
      return handler(endpoint, safe)
    }),
  }
  return { remote, calls }
}

/** 稳定错误码错误（模拟网络边界抛出的业务失败）。 */
function remoteError(message: string, code: string): RemoteError {
  const error = new Error(message) as RemoteError
  error.code = code
  return error
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function entry(overrides: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: 'ex-1',
    active: true,
    experienceType: 'agent',
    responsibility: '重构旧模块',
    taskType: '软件开发',
    decisionDomain: '重构顺序',
    situation: '旧模块缺少测试',
    trigger: '再次重构旧模块',
    principle: '先补测试再重构',
    recommendedAction: '先补测试',
    exclusions: [],
    evidence: [],
    taskRetrievalText: '任务侧投影',
    decisionRetrievalText: '决策侧投影',
    sourceRunId: 'run-1',
    generationPromptId: 'prompt-1',
    generationPromptVersion: 'v1',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  }
}

/** 覆盖列表字段（用于断言缺失 / null 的容错投影；真实条目的列表字段必为数组）。 */
function withLists(base: ExperienceEntry, lists: { exclusions?: unknown; evidence?: unknown }): ExperienceEntry {
  return { ...base, ...lists } as ExperienceEntry
}

/** 长期统计样本（Host 派生事实；界面只读展示，保存补丁必须忽略它）。 */
function stats(): NonNullable<ExperienceEntry['stats']> {
  return {
    experienceId: 'ex-1',
    effectiveSampleCount: 3.5,
    recalledCount: 7,
    usedCount: 4,
    fitMean: 0.8,
    empiricalValue: -0.25,
    variance: 0.02,
    stability: 0.9,
    evidenceStrength: 0.63,
    harmCount: 1,
    harmRate: 0.25,
    harmSeverity: 0.5,
    qualitySignal: 0.3,
    trust: 0.5,
    updatedAt: 20,
  }
}

interface HarnessResult {
  face: ExperiencesFace
  dispatched: Array<{ type: string; [key: string]: unknown }>
  toasts: Array<{ kind: string; text: string }>
  errors: unknown[]
}

/** 渲染 useExperiences（dispatch/notify 记录，state 由调用方给出）。 */
async function renderExperiences(remote: RemoteFace, state: StudioState = createInitialState('s-1')): Promise<HarnessResult> {
  const dispatched: Array<{ type: string; [key: string]: unknown }> = []
  const toasts: Array<{ kind: string; text: string }> = []
  const errors: unknown[] = []
  let face: ExperiencesFace | null = null
  const dispatch = ((action: { type: string }) => { dispatched.push(action) }) as never
  const notify = (kind: 'info' | 'success' | 'error', text: string): void => { toasts.push({ kind, text }) }
  const toastError = (error: unknown): void => { errors.push(error) }
  function Harness(): null {
    const f = useExperiences(remote, dispatch, notify, toastError, zh, state)
    useEffect(() => { face = f }, [f])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { face: face!, dispatched, toasts, errors }
}

describe('useExperiences：四个经验端点的调用与参数', () => {
  it('test_刷新_无参调用listExperiences_写入列表状态', async () => {
    const { remote, calls } = makeRemote(() => [entry(), entry({ id: 'ex-2', active: false })])
    const { face, dispatched } = await renderExperiences(remote)

    await act(async () => { await face.refresh() })

    expect(calls).toEqual([{ endpoint: EP.EP_LIST_EXPERIENCES, args: {} }])
    expect(dispatched).toEqual([{ type: 'EXPERIENCES_LOADED', items: [entry(), entry({ id: 'ex-2', active: false })] }])
  })

  it('test_刷新_响应不是数组_降级为空列表', async () => {
    const { remote } = makeRemote(() => ({ items: [] }))
    const { face, dispatched } = await renderExperiences(remote)

    await act(async () => { await face.refresh() })

    expect(dispatched).toEqual([{ type: 'EXPERIENCES_LOADED', items: [] }])
  })

  it('test_保存_按id与九个语义字段补丁上报_成功后刷新详情槽并提示', async () => {
    const updated = entry({ principle: '改写后的原则', updatedAt: 20 })
    const { remote, calls } = makeRemote(() => updated)
    const { face, toasts, dispatched } = await renderExperiences(remote)

    const result = await act(async () => await face.save(entry({
      evidence: ['证据'],
      principle: '改写后的原则',
      // 条目携带长期统计：保存仍不得把它随补丁回传（统计是 Host 派生事实）
      stats: stats(),
    })))

    expect(calls).toEqual([{
      endpoint: EP.EP_SAVE_EXPERIENCE,
      args: {
        experienceId: 'ex-1',
        patch: {
          responsibility: '重构旧模块',
          taskType: '软件开发',
          decisionDomain: '重构顺序',
          situation: '旧模块缺少测试',
          trigger: '再次重构旧模块',
          principle: '改写后的原则',
          recommendedAction: '先补测试',
          exclusions: [],
          evidence: ['证据'],
        },
      },
    }])
    expect(result).toEqual(updated)
    expect(dispatched).toEqual([{ type: 'EXPERIENCE_LOADED', entry: updated }])
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastExperienceSaved }])
  })

  it('test_保存_列表字段缺失_上报null表达清空', async () => {
    const { remote, calls } = makeRemote(() => entry())
    const { face } = await renderExperiences(remote)

    await act(async () => { await face.save(withLists(entry(), { exclusions: undefined, evidence: undefined })) })

    const patch = calls[0].args.patch as Record<string, unknown>
    expect(patch.exclusions).toBeNull()
    expect(patch.evidence).toBeNull()
  })

  it('test_归档_调用retireExperience并重取列表', async () => {
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_RETIRE_EXPERIENCE
      ? entry({ active: false })
      : [entry({ active: false })]))
    const { face, toasts } = await renderExperiences(remote)

    const ok = await act(async () => await face.setActive('ex-1', false))

    expect(ok).toBe(true)
    expect(calls).toEqual([
      { endpoint: EP.EP_RETIRE_EXPERIENCE, args: { experienceId: 'ex-1' } },
      { endpoint: EP.EP_LIST_EXPERIENCES, args: {} },
    ])
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastExperienceRetired }])
  })

  it('test_恢复_调用restoreExperience并重取列表', async () => {
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_RESTORE_EXPERIENCE
      ? entry()
      : [entry()]))
    const { face, toasts } = await renderExperiences(remote)

    const ok = await act(async () => await face.setActive('ex-1', true))

    expect(ok).toBe(true)
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_RESTORE_EXPERIENCE, EP.EP_LIST_EXPERIENCES])
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastExperienceRestored }])
  })

  it('test_打开_详情取自已装载列表_不发起远端调用', async () => {
    const { remote, calls } = makeRemote(() => [])
    const saved = entry()
    const state: StudioState = { ...createInitialState('s-1'), experiences: [saved] }
    const { face, dispatched } = await renderExperiences(remote, state)

    act(() => { face.open('ex-1') })

    expect(calls).toEqual([])
    expect(dispatched).toEqual([
      { type: 'EXPERIENCE_LOADED', entry: saved },
      { type: 'OPEN_EXPERIENCE', experienceId: 'ex-1' },
    ])
  })

  it('test_打开_列表里没有该id_不做任何事', async () => {
    const { remote } = makeRemote(() => [])
    const { face, dispatched } = await renderExperiences(remote, createInitialState('s-1'))

    act(() => { face.open('ex-missing') })

    expect(dispatched).toEqual([])
  })
})

describe('useExperiences：失败语义', () => {
  it('test_经验不存在_提示并刷新经验列表', async () => {
    const { remote } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_EXPERIENCE) throw remoteError('经验不存在', EP.ERR_EXPERIENCE_NOT_FOUND)
      return [entry()]
    })
    const { face, toasts, errors, dispatched } = await renderExperiences(remote)

    const result = await act(async () => await face.save(entry()))

    expect(result).toBeNull()
    expect(toasts).toEqual([{ kind: 'error', text: zh.experienceNotFound }])
    expect(errors).toEqual([])
    expect(dispatched).toContainEqual({ type: 'EXPERIENCES_LOADED', items: [entry()] })
  })

  it('test_保存失败_通用错误交给 toastError_不写详情槽', async () => {
    const failure = new Error('服务不可用')
    const { remote } = makeRemote(() => { throw failure })
    const { face, errors, dispatched } = await renderExperiences(remote)

    const result = await act(async () => await face.save(entry()))

    expect(result).toBeNull()
    expect(errors).toEqual([failure])
    expect(dispatched).toEqual([])
  })

  it('test_状态切换_响应形状非法_视为失败且不写状态', async () => {
    const { remote } = makeRemote(() => ({ ok: true }))
    const { face, dispatched, toasts } = await renderExperiences(remote)

    const ok = await act(async () => await face.setActive('ex-1', false))

    expect(ok).toBe(false)
    expect(dispatched).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('useExperiences：竞态与卸载', () => {
  it('test_刷新_迟到响应_不覆盖最新一次列表', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    let call = 0
    const { remote } = makeRemote(() => {
      call += 1
      return call === 1 ? first.promise : second.promise
    })
    const { face, dispatched } = await renderExperiences(remote)

    let pending1: Promise<void> | null = null
    let pending2: Promise<void> | null = null
    await act(async () => {
      pending1 = face.refresh()
      pending2 = face.refresh()
    })
    await act(async () => {
      second.resolve([entry({ id: 'ex-最新' })])
      await pending2
      first.resolve([entry({ id: 'ex-迟到' })])
      await pending1
    })

    expect(dispatched).toEqual([{ type: 'EXPERIENCES_LOADED', items: [entry({ id: 'ex-最新' })] }])
  })

  it('test_卸载后_远端回调到达_不再写入状态', async () => {
    const pending = deferred<unknown>()
    const { remote } = makeRemote(() => pending.promise)
    const { face, dispatched } = await renderExperiences(remote)

    let refreshing: Promise<void> | null = null
    await act(async () => { refreshing = face.refresh() })
    act(() => { root?.unmount(); root = null })
    await act(async () => {
      pending.resolve([entry()])
      await refreshing
    })

    expect(dispatched).toEqual([])
  })
})

describe('experiencePatchOf（保存载荷投影）', () => {
  it('test_投影_只含九个语义字段且列表字段原样保留', () => {
    expect(experiencePatchOf(entry({ exclusions: ['一次性脚本'], evidence: ['缺陷率下降'] }))).toEqual({
      responsibility: '重构旧模块',
      taskType: '软件开发',
      decisionDomain: '重构顺序',
      situation: '旧模块缺少测试',
      trigger: '再次重构旧模块',
      principle: '先补测试再重构',
      recommendedAction: '先补测试',
      exclusions: ['一次性脚本'],
      evidence: ['缺陷率下降'],
    })
  })

  it('test_投影_空文本域的空数组原样上报', () => {
    const patch = experiencePatchOf(entry({ exclusions: [], evidence: [] }))

    expect(patch.exclusions).toEqual([])
    expect(patch.evidence).toEqual([])
  })

  it('test_投影_列表字段为null或缺失_上报null表达清空', () => {
    expect(experiencePatchOf(withLists(entry(), { exclusions: null, evidence: undefined }))).toMatchObject({
      exclusions: null,
      evidence: null,
    })
  })

  it('test_投影_不回传只读元信息（id/主体类型/状态/投影/向量/时间戳）', () => {
    const patch = experiencePatchOf(entry({ id: 'ex-9', active: false, createdAt: 1, updatedAt: 2, sourceRunId: 'run-1' }))

    expect(Object.keys(patch).sort()).toEqual([
      'decisionDomain', 'evidence', 'exclusions', 'principle', 'recommendedAction', 'responsibility', 'situation', 'taskType', 'trigger',
    ])
  })

  it('test_投影_条目携带长期统计_补丁仍只含九个语义字段', () => {
    const patch = experiencePatchOf(entry({ stats: stats() }))

    expect('stats' in patch).toBe(false)
    expect(Object.keys(patch).sort()).toEqual([
      'decisionDomain', 'evidence', 'exclusions', 'principle', 'recommendedAction', 'responsibility', 'situation', 'taskType', 'trigger',
    ])
  })
})
