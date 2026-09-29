// src/client/hooks/useAssets.ts
//
// 资产面（模版晋升而来的可复用资料）：列表加载 / 详情装载 / 入库晋升 /
// 登记新版本 / 版本列表 / 回滚 / 归档 / 恢复 / 影响面预览。
//
// 语义边界（用户裁决）：模版 = 可随意修改的草稿；资产 = 带版本控制与回滚，
// 版本历史永不被改写（回滚只改 Active 指针）；归档 = 移出活跃复用面，历史与引用统计全保留；
// 恢复（取最新版本行重建 Active 指针）才是重新进入活跃面的界面入口。
// 后端仍保留「归档资产回滚即重新启用」的旧行为（见 assets 模块的职责分离遗留标记），
// 界面侧据此不再向历史资产提供回滚按钮——避免同一状态转换有两条入口。
//
// 职责边界：本 hook 只做「远端调用 + 状态写入 + 失败语义 + toast」；
// 资产态的画布投影与文档生命周期在 studio 状态机与 useDocumentActions 中完成。
//
// 失败语义（client AGENTS「数据流与数据访问边界」）：稳定错误码按语义分支——
// ERR_ASSET_DUPLICATE（重复入库）提示「重复入库已取消」并保留原列表；
// ERR_ASSET_NOT_FOUND（资产不存在/已归档）提示并刷新资产列表。
// 异步防竞态：列表与详情加载各持一份请求序号，只有最新一次请求可写状态；
// 卸载后一律不写。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type {
  AssetDetail, AssetKind, AssetVersionEntry, RoleAssetDetail, RoleAssetReference, RoleAssetType, WorkflowAssetDetail,
} from '../../host/shared/asset-types.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import type { RemoteError } from '../lib/remote.js'
import type { ToastFace } from './useToast.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

/** 入库 / 登记新版本的返回面（后端 promoteAsset / saveAssetVersion 契约）。 */
export interface AssetPromoteResult {
  assetId: string
  versionId: number
  rowId: string
  /** true = 内容与当前基线版本全等，未新增版本（去重命中）。 */
  unchanged: boolean
  /** 角色资产的种类（角色入库返回）。 */
  roleAssetType?: RoleAssetType
  /** 因本次入库被判定为共享的角色资产 id 列表。 */
  sharedRoleAssetIds?: string[]
  /** 因本次登记失去全部工作流引用而被自动归档的角色资产 id 列表。 */
  archivedRoleAssetIds?: string[]
}

export interface AssetsFace {
  assets: StudioState['assets']
  assetDoc: StudioState['assetDoc']
  assetVersions: StudioState['assetVersions']
  /** 重新加载资产列表（活跃 + 历史（已归档））。 */
  refresh(): Promise<void>
  /** 取单个资产详情（按 kind 装载对应状态槽；失败返回 null）。 */
  loadAsset(kind: AssetKind, assetId: string): Promise<AssetDetail | null>
  /** 模版 → 资产入库（同一模版再次入库 = 同一资产的新版本）。 */
  promote(kind: AssetKind, templateId: string): Promise<AssetPromoteResult | null>
  /** 资产态保存：登记该资产的新版本。 */
  saveVersion(kind: AssetKind, assetId: string, payload: unknown): Promise<AssetPromoteResult | null>
  /**
   * 保存前的影响面预览（只读）：本次内容会牵连哪些**其他**工作流资产。
   * 判定归 Host（角色字段映射与共享判定都是 Host 的事实），本面只转发与降级。
   */
  previewCascade(kind: AssetKind, assetId: string | null, payload: unknown): Promise<RoleAssetReference[]>
  /** 打开版本上拉列表数据（回滚选择）。 */
  openVersions(kind: AssetKind, assetId: string): Promise<void>
  /** 关闭版本上拉列表数据。 */
  closeVersions(): void
  /**
   * 回滚 Active 指针到历史版本（不改写历史版本内容）；归档资产的回滚即重新启用。
   * @returns 回滚后的详情（失败返回 null；调用方据此保留现场，并用详情刷新画布节点内容）。
   */
  rollback(kind: AssetKind, assetId: string, versionId: number): Promise<AssetDetail | null>
  /**
   * 归档资产（Active 移除、历史与版本内容全保留；不删除任何版本行）。
   * @returns 是否成功（语义同 rollback）。
   */
  retire(kind: AssetKind, assetId: string): Promise<boolean>
  /**
   * 恢复历史（已归档）资产：取最新版本行重建 Active 指针（状态转换的唯一入口）。
   * @returns 恢复后的详情（失败返回 null；调用方据此刷新界面）。
   */
  restore(kind: AssetKind, assetId: string): Promise<AssetDetail | null>
  /** 打开工作流资产文档：装载详情后把画布切到该资产（资产态画布文档）。 */
  openFlowAsset(assetId: string): Promise<void>
  /** 打开角色资产：装载详情后在属性栏编辑。 */
  openRoleAsset(assetId: string): Promise<void>
}

/** 资产列表响应归一化（形状漂移一律降级为空列表，不因未知字段抛错）。 */
function normalizeList(payload: unknown): StudioState['assets'] {
  const record = (payload ?? {}) as {
    workflows?: unknown
    roles?: unknown
    retiredWorkflows?: unknown
    retiredRoles?: unknown
  }
  return {
    workflows: Array.isArray(record.workflows) ? record.workflows : [],
    roles: Array.isArray(record.roles) ? record.roles : [],
    retiredWorkflows: Array.isArray(record.retiredWorkflows) ? record.retiredWorkflows : [],
    retiredRoles: Array.isArray(record.retiredRoles) ? record.retiredRoles : [],
  }
}

/** 远端错误的稳定码（无码 = 传输/解析失败）。 */
function codeOf(error: unknown): string {
  return String((error as RemoteError | null | undefined)?.code ?? '')
}

/** 资产面（远端失败已就地翻译为提示；返回值 null 表示本次调用未产生结果）。 */
export function useAssets(
  remote: RemoteFace,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  state: StudioState,
): AssetsFace {
  /** 卸载守卫：卸载后不再写状态。 */
  const mounted = useRef(true)
  /** 列表请求序号（只有最新一次刷新可写状态）。 */
  const listSeq = useRef(0)
  /** 详情请求序号（切换资产后迟到的装载不得覆盖当前资产）。 */
  const detailSeq = useRef(0)
  /** 版本列表请求序号（与详情装载各自独立，互不取消）。 */
  const versionsSeq = useRef(0)
  useEffect(() => () => {
    mounted.current = false
  }, [])
  /** 状态引用：回调闭包读最新状态（回滚后是否重投影画布等归属判定）。 */
  const stateRef = useRef(state)
  stateRef.current = state

  /** 资产失败统一翻译（稳定码优先）；返回 true = 已按资产语义处理（调用方不再提示）。 */
  const handleAssetFailure = useCallback(async (error: unknown, reload: boolean): Promise<boolean> => {
    const code = codeOf(error)
    if (code === EP.ERR_ASSET_DUPLICATE) {
      // 重复入库 = 内容与 Active 版本全等：不是错误，取消本次入库并保留原列表
      notify('info', t.assetDuplicateCancelled)
      return true
    }
    if (code === EP.ERR_ASSET_NOT_FOUND || code === EP.ERR_ASSET_VERSION_NOT_FOUND) {
      notify('error', t.assetNotFound)
      if (reload) {
        const seq = ++listSeq.current
        try {
          const payload = await remote.call(EP.EP_LIST_ASSETS, {})
          if (!mounted.current || seq !== listSeq.current) return true
          dispatch({ type: 'ASSETS_LOADED', ...normalizeList(payload) })
        } catch {
          // 刷新失败不再叠加提示（首条提示已说明资产不存在）
        }
      }
      return true
    }
    return false
  }, [dispatch, notify, remote, t.assetDuplicateCancelled, t.assetNotFound])

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++listSeq.current
    try {
      const payload = await remote.call(EP.EP_LIST_ASSETS, {})
      // 归属校验：只有最新一次刷新可写（旧的迟到响应丢弃）；卸载后不写
      if (!mounted.current || seq !== listSeq.current) return
      dispatch({ type: 'ASSETS_LOADED', ...normalizeList(payload) })
    } catch (error) {
      if (!mounted.current || seq !== listSeq.current) return
      if (await handleAssetFailure(error, false)) return
      toastError(error)
    }
  }, [dispatch, handleAssetFailure, remote, toastError])

  const loadAsset = useCallback(async (kind: AssetKind, assetId: string): Promise<AssetDetail | null> => {
    const seq = ++detailSeq.current
    try {
      const detail = await remote.call(EP.EP_GET_ASSET, { kind, assetId }) as AssetDetail | null
      if (!detail) return null
      if (!mounted.current || seq !== detailSeq.current) return null
      if (kind === 'role') dispatch({ type: 'ROLE_ASSET_LOADED', detail: detail as RoleAssetDetail })
      else dispatch({ type: 'ASSET_DOC_LOADED', detail: detail as WorkflowAssetDetail })
      return detail
    } catch (error) {
      if (!mounted.current) return null
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [dispatch, handleAssetFailure, remote, toastError])

  /**
   * 入库 / 登记新版本共用后处理：成功刷新列表并提示。
   * 提示必须让用户知道「写的是哪个资产、写成了哪一版」，因此把 assetId / versionId 代入词条模板；
   * 后端幂等短路（unchanged）时改用「内容未变化，未新增版本」，避免给出「已入库」的错误暗示。
   * 写路径的副作用明细（共享合并、因失去全部引用而自动归档的角色资产）在此一并告知用户：
   * 这些事实由 Host 在事务内结算，界面只能事后提示，不能事后猜测。
   */
  const afterWrite = useCallback(async (result: AssetPromoteResult | null, successText: string): Promise<AssetPromoteResult | null> => {
    if (!result) return null
    if (!mounted.current) return result
    if (result.unchanged) {
      notify('info', t.assetPromoteUnchanged)
    } else {
      notify('success', successText.replace('{id}', result.assetId).replace('{version}', String(result.versionId)))
    }
    const archivedCount = (result.archivedRoleAssetIds ?? []).length
    if (archivedCount > 0) {
      notify('info', t.assetAutoArchived.replace('{count}', String(archivedCount)))
    }
    await refresh()
    return result
  }, [notify, refresh, t.assetAutoArchived, t.assetPromoteUnchanged])

  const promote = useCallback(async (kind: AssetKind, templateId: string): Promise<AssetPromoteResult | null> => {
    try {
      const result = await remote.call(EP.EP_PROMOTE_ASSET, { kind, templateId }) as AssetPromoteResult | null
      return await afterWrite(result, t.toastAssetPromoted)
    } catch (error) {
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [afterWrite, handleAssetFailure, remote, t.toastAssetPromoted, toastError])

  const saveVersion = useCallback(async (kind: AssetKind, assetId: string, payload: unknown): Promise<AssetPromoteResult | null> => {
    try {
      const result = await remote.call(EP.EP_SAVE_ASSET_VERSION, { kind, assetId, payload }) as AssetPromoteResult | null
      return await afterWrite(result, t.toastAssetVersionSaved)
    } catch (error) {
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [afterWrite, handleAssetFailure, remote, t.toastAssetVersionSaved, toastError])

  /**
   * 保存前的影响面预览（只读）。失败一律降级为「无可告知的影响面」并显式提示：
   * 预览只是告知辅助，不得阻断保存；但静默失败会让用户把「提示缺失」误读成「没有级联影响」。
   */
  const previewCascade = useCallback(async (
    kind: AssetKind,
    assetId: string | null,
    payload: unknown,
  ): Promise<RoleAssetReference[]> => {
    try {
      const result = await remote.call(EP.EP_PREVIEW_ASSET_CASCADE, { kind, assetId, payload }) as { affected?: unknown } | null
      const affected = result?.affected
      return Array.isArray(affected) ? affected as RoleAssetReference[] : []
    } catch (error) {
      if (await handleAssetFailure(error, false)) return []
      toastError(error)
      return []
    }
  }, [handleAssetFailure, remote, toastError])

  const openVersions = useCallback(async (kind: AssetKind, assetId: string): Promise<void> => {
    const seq = ++versionsSeq.current
    try {
      const items = await remote.call(EP.EP_LIST_ASSET_VERSIONS, { kind, assetId }) as AssetVersionEntry[] | null
      if (!mounted.current || seq !== versionsSeq.current) return
      dispatch({ type: 'ASSET_VERSIONS_LOADED', kind, assetId, items: Array.isArray(items) ? items : [] })
    } catch (error) {
      if (!mounted.current) return
      if (await handleAssetFailure(error, true)) return
      toastError(error)
    }
  }, [dispatch, handleAssetFailure, remote, toastError])

  const closeVersions = useCallback((): void => {
    dispatch({ type: 'ASSET_VERSIONS_CLOSED' })
  }, [dispatch])

  /**
   * 回滚到指定版本：只改 Active 指针（不新增版本）；归档资产的回滚 = 重建 Active 行（重新启用）。
   * 返回值 = 回滚后的详情（失败返回 null）：调用方据此决定要不要收起版本列表、刷新界面，
   * 画布角色节点还要用该详情把节点内容刷新为所选版本（节点是该资产的画布内联副本）。
   */
  const rollback = useCallback(async (kind: AssetKind, assetId: string, versionId: number): Promise<AssetDetail | null> => {
    try {
      await remote.call(EP.EP_ROLLBACK_ASSET, { kind, assetId, versionId })
      if (!mounted.current) return null
      notify('success', t.toastAssetRolledBack)
      // 重新装载 Active 详情；若该工作流资产正开在画布上，同步重投影画布
      const detail = await loadAsset(kind, assetId)
      if (!mounted.current) return null
      const current = stateRef.current
      if (kind === 'workflow' && current.currentKind === 'flowAsset' && current.currentId === assetId) {
        dispatch({ type: 'OPEN_FLOW_ASSET', assetId })
      }
      await refresh()
      return detail
    } catch (error) {
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [dispatch, handleAssetFailure, loadAsset, notify, refresh, remote, t.toastAssetRolledBack, toastError])

  /** 归档资产（Active 移除、历史与版本内容全保留）；返回值 = 是否成功，语义同 rollback。 */
  const retire = useCallback(async (kind: AssetKind, assetId: string): Promise<boolean> => {
    try {
      await remote.call(EP.EP_RETIRE_ASSET, { kind, assetId })
      if (!mounted.current) return true
      notify('success', t.toastAssetRetired)
      await refresh()
      return true
    } catch (error) {
      if (await handleAssetFailure(error, true)) return false
      toastError(error)
      return false
    }
  }, [handleAssetFailure, notify, refresh, remote, t.toastAssetRetired, toastError])

  /**
   * 恢复历史（已归档）资产：取最新版本行重建 Active 指针；返回值 = 恢复后的详情（失败 null）。
   * 与回滚的分工见共享协议：恢复管状态转换，回滚管版本与 Active 指针。
   */
  const restore = useCallback(async (kind: AssetKind, assetId: string): Promise<AssetDetail | null> => {
    try {
      await remote.call(EP.EP_RESTORE_ASSET, { kind, assetId })
      if (!mounted.current) return null
      notify('success', t.toastAssetRestored)
      // 重新装载 Active 详情；若该工作流资产正开在画布上，同步重投影画布
      const detail = await loadAsset(kind, assetId)
      if (!mounted.current) return null
      const current = stateRef.current
      if (kind === 'workflow' && current.currentKind === 'flowAsset' && current.currentId === assetId) {
        dispatch({ type: 'OPEN_FLOW_ASSET', assetId })
      }
      await refresh()
      return detail
    } catch (error) {
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [dispatch, handleAssetFailure, loadAsset, notify, refresh, remote, t.toastAssetRestored, toastError])

  const openFlowAsset = useCallback(async (assetId: string): Promise<void> => {
    const detail = await loadAsset('workflow', assetId) as WorkflowAssetDetail | null
    if (!detail || !mounted.current) return
    dispatch({ type: 'OPEN_FLOW_ASSET', assetId })
  }, [dispatch, loadAsset])

  const openRoleAsset = useCallback(async (assetId: string): Promise<void> => {
    const detail = await loadAsset('role', assetId) as RoleAssetDetail | null
    if (!detail || !mounted.current) return
    dispatch({ type: 'OPEN_ROLE_ASSET', assetId })
  }, [dispatch, loadAsset])

  return {
    assets: state.assets,
    assetDoc: state.assetDoc,
    assetVersions: state.assetVersions,
    refresh, loadAsset, promote, saveVersion, previewCascade, openVersions, closeVersions, rollback, retire, restore,
    openFlowAsset, openRoleAsset,
  }
}
