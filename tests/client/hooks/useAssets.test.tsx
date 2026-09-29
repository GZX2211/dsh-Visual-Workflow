// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/hooks/useAssets.test.tsx
//
// useAssets（hooks/useAssets.ts）单测：
//   ① 七个资产端点（listAssets / getAsset / promoteAsset / saveAssetVersion /
//      listAssetVersions / rollbackAsset / retireAsset）的调用与参数；
//   ② 错误码分支：ERR_ASSET_DUPLICATE → 「重复入库已取消」且不刷新；
//      ERR_ASSET_NOT_FOUND → 提示 + 刷新资产列表；
//   ③ 竞态与卸载：迟到的详情响应不覆盖当前资产；卸载后不再 dispatch。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { useAssets, type AssetsFace } from '../../../src/client/hooks/useAssets.js'
import type { RemoteFace } from '../../../src/client/hooks/useRemote.js'
import type { RemoteError } from '../../../src/client/lib/remote.js'
import { EP } from '../../../src/client/lib/remote.js'
import { createInitialState, type StudioState } from '../../../src/client/studio/studio-state.js'
import { zh } from '../../../src/client/i18n.js'

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

interface HarnessResult {
  face: AssetsFace
  dispatched: Array<{ type: string; [key: string]: unknown }>
  toasts: Array<{ kind: string; text: string }>
  errors: unknown[]
}

/** 渲染 useAssets（dispatch/notify 记录，state 由调用方给出）。 */
async function renderAssets(remote: RemoteFace, state: StudioState = createInitialState('s-1')): Promise<HarnessResult> {
  const dispatched: Array<{ type: string; [key: string]: unknown }> = []
  const toasts: Array<{ kind: string; text: string }> = []
  const errors: unknown[] = []
  let face: AssetsFace | null = null
  const dispatch = ((action: { type: string }) => { dispatched.push(action) }) as never
  const notify = (kind: 'info' | 'success' | 'error', text: string): void => { toasts.push({ kind, text }) }
  const toastError = (error: unknown): void => { errors.push(error) }
  function Harness(): null {
    const f = useAssets(remote, dispatch, notify, toastError, zh, state)
    useEffect(() => { face = f }, [f])
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return { face: face!, dispatched, toasts, errors }
}

const WORKFLOW_DETAIL = {
  assetId: 'a-1', versionId: 2, rowId: 'row-2', mode: 'mode1', name: '资产一', description: '',
  nodes: [], lines: [], roleVersionIds: [], createdAt: 1,
}
const ROLE_DETAIL = {
  assetId: 'a-r1', versionId: 1, rowId: 'row-1', kind: 'agent', roleAssetType: 'standalone',
  name: '资产角色', systemPrompt: '', provider: '', model: '', retryLimit: 3, referenceWorkflowIds: [], createdAt: 1,
}

describe('useAssets：八个资产端点的调用与参数', () => {
  it('refresh → listAssets（无参）并写入规范化列表（活跃 + 历史）', async () => {
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_LIST_ASSETS
      ? {
          workflows: [{ assetId: 'a-1' }],
          roles: [{ assetId: 'a-r1' }],
          retiredWorkflows: [{ assetId: 'a-old' }],
          retiredRoles: [{ assetId: 'a-rold' }],
        }
      : []))
    const { face, dispatched } = await renderAssets(remote)
    await act(async () => { await face.refresh() })
    expect(calls).toEqual([{ endpoint: EP.EP_LIST_ASSETS, args: {} }])
    expect(dispatched).toEqual([
      {
        type: 'ASSETS_LOADED',
        workflows: [{ assetId: 'a-1' }],
        roles: [{ assetId: 'a-r1' }],
        retiredWorkflows: [{ assetId: 'a-old' }],
        retiredRoles: [{ assetId: 'a-rold' }],
      },
    ])
  })

  it('refresh → 响应形状漂移（数组/缺字段）降级为空列表，不抛错', async () => {
    const { remote } = makeRemote(() => [])
    const { face, dispatched } = await renderAssets(remote)
    await act(async () => { await face.refresh() })
    // 旧形状（无历史字段）同样降级为空历史列表：形状漂移不因未知字段抛错
    expect(dispatched).toEqual([
      { type: 'ASSETS_LOADED', workflows: [], roles: [], retiredWorkflows: [], retiredRoles: [] },
    ])
  })

  it('loadAsset：workflow → getAsset{kind,assetId} + ASSET_DOC_LOADED；role → ROLE_ASSET_LOADED', async () => {
    const { remote, calls } = makeRemote((endpoint, args) => (endpoint === EP.EP_GET_ASSET
      ? (args.kind === 'role' ? ROLE_DETAIL : WORKFLOW_DETAIL)
      : []))
    const { face, dispatched } = await renderAssets(remote)
    let detail: unknown = null
    await act(async () => { detail = await face.loadAsset('workflow', 'a-1') })
    expect(detail).toEqual(WORKFLOW_DETAIL)
    await act(async () => { detail = await face.loadAsset('role', 'a-r1') })
    expect(detail).toEqual(ROLE_DETAIL)
    expect(calls).toEqual([
      { endpoint: EP.EP_GET_ASSET, args: { kind: 'workflow', assetId: 'a-1' } },
      { endpoint: EP.EP_GET_ASSET, args: { kind: 'role', assetId: 'a-r1' } },
    ])
    expect(dispatched).toEqual([
      { type: 'ASSET_DOC_LOADED', detail: WORKFLOW_DETAIL },
      { type: 'ROLE_ASSET_LOADED', detail: ROLE_DETAIL },
    ])
  })

  it('promote → promoteAsset{kind,templateId}，成功后提示并刷新列表', async () => {
    const promoted = { assetId: 'a-1', versionId: 1, rowId: 'row-1', unchanged: false }
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_PROMOTE_ASSET ? promoted : { workflows: [], roles: [] }))
    const { face, toasts, dispatched } = await renderAssets(remote)
    let result: unknown = null
    await act(async () => { result = await face.promote('workflow', 'tpl-1') })
    expect(result).toEqual(promoted)
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PROMOTE_ASSET, EP.EP_LIST_ASSETS])
    expect(calls[0]!.args).toEqual({ kind: 'workflow', templateId: 'tpl-1' })
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastAssetPromoted.replace('{id}', 'a-1').replace('{version}', '1') }])
    expect(dispatched.some((action) => action.type === 'ASSETS_LOADED')).toBe(true)
  })

  it('saveVersion → saveAssetVersion{kind,assetId,payload}', async () => {
    const saved = { assetId: 'a-1', versionId: 3, rowId: 'row-3', unchanged: false }
    const { remote, calls } = makeRemoteWith(EP.EP_SAVE_ASSET_VERSION, saved)
    const { face, toasts } = await renderAssets(remote)
    const payload = { nodes: [{ id: 'n1' }], lines: [] }
    await act(async () => { await face.saveVersion('workflow', 'a-1', payload) })
    expect(calls[0]).toEqual({ endpoint: EP.EP_SAVE_ASSET_VERSION, args: { kind: 'workflow', assetId: 'a-1', payload } })
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastAssetVersionSaved.replace('{id}', 'a-1').replace('{version}', '3') }])
  })

  it('openVersions / closeVersions → listAssetVersions{kind,assetId} + 版本列表装载/关闭', async () => {
    const items = [{ versionId: 2, rowId: 'row-2', name: 'v2', createdAt: 2, source: 'human', active: true }]
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_LIST_ASSET_VERSIONS ? items : []))
    const { face, dispatched } = await renderAssets(remote)
    await act(async () => { await face.openVersions('role', 'a-r1') })
    expect(calls[0]).toEqual({ endpoint: EP.EP_LIST_ASSET_VERSIONS, args: { kind: 'role', assetId: 'a-r1' } })
    expect(dispatched[0]).toEqual({ type: 'ASSET_VERSIONS_LOADED', kind: 'role', assetId: 'a-r1', items })
    await act(async () => { face.closeVersions() })
    expect(dispatched[1]).toEqual({ type: 'ASSET_VERSIONS_CLOSED' })
  })

  it('rollback → rollbackAsset{kind,assetId,versionId} + 返回回滚后的详情（供画布节点刷新）', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_ROLLBACK_ASSET) return WORKFLOW_DETAIL
      if (endpoint === EP.EP_GET_ASSET) return WORKFLOW_DETAIL
      return { workflows: [], roles: [] }
    })
    const { face, toasts, dispatched } = await renderAssets(remote)

    let rolled: unknown = null
    await act(async () => { rolled = await face.rollback('workflow', 'a-1', 1) })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_ROLLBACK_ASSET, EP.EP_GET_ASSET, EP.EP_LIST_ASSETS])
    expect(calls[0]!.args).toEqual({ kind: 'workflow', assetId: 'a-1', versionId: 1 })
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastAssetRolledBack }])
    expect(dispatched.map((action) => action.type)).toContain('ASSET_DOC_LOADED')
    expect(rolled).toEqual(WORKFLOW_DETAIL)
  })

  it('rollback：当前画布正打开该工作流资产时重投影画布（OPEN_FLOW_ASSET）', async () => {
    const { remote } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_GET_ASSET) return WORKFLOW_DETAIL
      if (endpoint === EP.EP_ROLLBACK_ASSET) return WORKFLOW_DETAIL
      return { workflows: [], roles: [] }
    })
    const state: StudioState = {
      ...createInitialState('s-1'),
      currentKind: 'flowAsset',
      currentId: 'a-1',
      assetDoc: WORKFLOW_DETAIL as never,
    }
    const { face, dispatched } = await renderAssets(remote, state)
    await act(async () => { await face.rollback('workflow', 'a-1', 1) })
    expect(dispatched.some((action) => action.type === 'OPEN_FLOW_ASSET' && action.assetId === 'a-1')).toBe(true)
  })

  it('rollback：打开的是别的文档时不重投影画布', async () => {
    const { remote } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_GET_ASSET) return WORKFLOW_DETAIL
      if (endpoint === EP.EP_ROLLBACK_ASSET) return WORKFLOW_DETAIL
      return { workflows: [], roles: [] }
    })
    const state: StudioState = { ...createInitialState('s-1'), currentKind: 'workflow', currentId: 'wf-9' }
    const { face, dispatched } = await renderAssets(remote, state)
    await act(async () => { await face.rollback('workflow', 'a-1', 1) })
    expect(dispatched.some((action) => action.type === 'OPEN_FLOW_ASSET')).toBe(false)
  })

  it('retire → retireAsset{kind,assetId} + 提示 + 刷新列表 + 返回成功标志', async () => {
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_RETIRE_ASSET ? { kind: 'workflow', assetId: 'a-1', retired: true } : { workflows: [], roles: [] }))
    const { face, toasts } = await renderAssets(remote)
    let retired = false
    await act(async () => { retired = await face.retire('workflow', 'a-1') })
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_RETIRE_ASSET, EP.EP_LIST_ASSETS])
    expect(calls[0]!.args).toEqual({ kind: 'workflow', assetId: 'a-1' })
    expect(toasts).toEqual([{ kind: 'success', text: zh.toastAssetRetired }])
    // 成功标志：调用方据此才收起已退役资产的界面残留
    expect(retired).toBe(true)
  })

  it('rollback 领域失败 → 返回 null（调用方保留现场，不误判已生效）', async () => {
    const rollbackRemote = makeRemote(() => { throw remoteError('not found', EP.ERR_ASSET_NOT_FOUND) })
    const rollbackHarness = await renderAssets(rollbackRemote.remote)
    let rolled: unknown = 'unset'
    await act(async () => { rolled = await rollbackHarness.face.rollback('workflow', 'a-1', 1) })
    expect(rolled).toBeNull()
    expect(rollbackHarness.toasts[0]).toEqual({ kind: 'error', text: zh.assetNotFound })
  })

  it('saveVersion 幂等短路（unchanged）→ 只提示「内容未变化」，不谎报已登记新版本', async () => {
    const { remote, calls } = makeRemote((endpoint) => (endpoint === EP.EP_SAVE_ASSET_VERSION
      ? { assetId: 'a-1', versionId: 3, rowId: 'a-1@3', unchanged: true }
      : { workflows: [], roles: [] }))
    const { face, toasts } = await renderAssets(remote)

    await act(async () => { await face.saveVersion('workflow', 'a-1', { nodes: [], lines: [] }) })

    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_SAVE_ASSET_VERSION, EP.EP_LIST_ASSETS])
    expect(toasts).toEqual([{ kind: 'info', text: zh.assetPromoteUnchanged }])
  })

  it('openFlowAsset / openRoleAsset：装载详情后切到资产态（OPEN_FLOW_ASSET / OPEN_ROLE_ASSET）', async () => {
    const { remote } = makeRemote((endpoint, args) => (endpoint === EP.EP_GET_ASSET
      ? (args.kind === 'role' ? ROLE_DETAIL : WORKFLOW_DETAIL)
      : []))
    const { face, dispatched } = await renderAssets(remote)
    await act(async () => { await face.openFlowAsset('a-1') })
    await act(async () => { await face.openRoleAsset('a-r1') })
    expect(dispatched.map((action) => action.type)).toEqual([
      'ASSET_DOC_LOADED', 'OPEN_FLOW_ASSET', 'ROLE_ASSET_LOADED', 'OPEN_ROLE_ASSET',
    ])
  })

  it('openFlowAsset：详情装载失败（未找到）→ 不切画布、不改编辑器', async () => {
    const { remote } = makeRemote(() => { throw remoteError('not found', EP.ERR_ASSET_NOT_FOUND) })
    const { face, dispatched, toasts } = await renderAssets(remote)
    await act(async () => { await face.openFlowAsset('a-missing') })
    expect(dispatched.some((action) => action.type === 'OPEN_FLOW_ASSET')).toBe(false)
    expect(toasts[0]).toEqual({ kind: 'error', text: zh.assetNotFound })
  })
})

describe('useAssets：错误码语义分支', () => {
  it('ERR_ASSET_DUPLICATE：提示「重复入库已取消」，不刷新列表、不报错', async () => {
    const { remote, calls } = makeRemote(() => { throw remoteError('duplicate', EP.ERR_ASSET_DUPLICATE) })
    const { face, toasts, errors } = await renderAssets(remote)
    let result: unknown = 'sentinel'
    await act(async () => { result = await face.promote('workflow', 'tpl-1') })
    expect(result).toBeNull()
    expect(toasts).toEqual([{ kind: 'info', text: zh.assetDuplicateCancelled }])
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_PROMOTE_ASSET])
    expect(errors).toEqual([])
  })

  it('ERR_ASSET_NOT_FOUND：提示并刷新资产列表（重试保存前的列表对账）', async () => {
    const { remote, calls } = makeRemote((endpoint) => {
      if (endpoint === EP.EP_SAVE_ASSET_VERSION) throw remoteError('gone', EP.ERR_ASSET_NOT_FOUND)
      return { workflows: [], roles: [] }
    })
    const { face, toasts, errors } = await renderAssets(remote)
    await act(async () => { await face.saveVersion('workflow', 'a-1', {}) })
    expect(toasts[0]).toEqual({ kind: 'error', text: zh.assetNotFound })
    expect(calls.map((call) => call.endpoint)).toEqual([EP.EP_SAVE_ASSET_VERSION, EP.EP_LIST_ASSETS])
    expect(errors).toEqual([])
  })

  it('其余失败（含传输失败）：沿用通用错误提示，不吞错', async () => {
    const failure = new Error('boom')
    const { remote } = makeRemote(() => { throw failure })
    const { face, toasts, errors } = await renderAssets(remote)
    await act(async () => { await face.refresh() })
    expect(errors).toEqual([failure])
    expect(toasts).toEqual([])
  })
})

describe('useAssets：竞态与卸载', () => {
  it('加载详情竞态：迟到的旧资产响应不覆盖当前资产（归属校验）', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const { remote, calls } = makeRemote((endpoint, args) => {
      if (endpoint !== EP.EP_GET_ASSET) return []
      return args.assetId === 'a-1' ? first.promise : second.promise
    })
    const { face, dispatched } = await renderAssets(remote)
    let p1: Promise<unknown> = Promise.resolve(null)
    let p2: Promise<unknown> = Promise.resolve(null)
    await act(async () => {
      p1 = face.loadAsset('workflow', 'a-1')
      p2 = face.loadAsset('workflow', 'a-2')
    })
    // 后发请求先返回（当前资产 = a-2）；再返回的 a-1 属陈旧装载 → 丢弃
    await act(async () => {
      second.resolve({ ...WORKFLOW_DETAIL, assetId: 'a-2' })
      await p2
    })
    await act(async () => {
      first.resolve(WORKFLOW_DETAIL)
      await p1
    })
    expect(calls).toHaveLength(2)
    expect(dispatched).toEqual([{ type: 'ASSET_DOC_LOADED', detail: { ...WORKFLOW_DETAIL, assetId: 'a-2' } }])
  })

  it('卸载后不写状态：在途 refresh 返回后不再 dispatch', async () => {
    const pending = deferred<unknown>()
    const { remote } = makeRemote(() => pending.promise)
    const { face, dispatched } = await renderAssets(remote)
    let inflight: Promise<void> = Promise.resolve()
    await act(async () => { inflight = face.refresh() })
    await act(async () => { root?.unmount(); root = null })
    await act(async () => {
      pending.resolve({ workflows: [{ assetId: 'a-1' }], roles: [] })
      await inflight
    })
    expect(dispatched).toEqual([])
  })
})

/** 单一端点返回固定值的假远端（简化「只关心一次写入调用」的用例）。 */
function makeRemoteWith(endpoint: string, value: unknown): {
  remote: RemoteFace
  calls: Array<{ endpoint: string; args: Record<string, unknown> }>
} {
  return makeRemote((current) => (current === endpoint ? value : { workflows: [], roles: [] }))
}
