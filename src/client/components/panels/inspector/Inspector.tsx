// src/client/components/panels/inspector/Inspector.tsx
//
// 右侧属性面板（照搬旧项目 inspector.js，TSX 化）：
// 所见即所操作——点击模板编辑模板、点击画布节点编辑节点实例、点击连线编辑连线；
// 底部保存/删除作用于当前选中对象；阶段无保存（只读）；虚拟节点只读。
// 底部按钮分录（用户裁决）：模版态 = 保存/删除/入库；资产态 = 保存/删除/回滚；
// 其余（实例/服务/节点/连线）= 保存/删除（+ 角色节点的复制、实例的另存为模板）。

import { useState } from 'react'
import type { Dict } from '../../../i18n.js'
import type { EditorData, StudioState } from '../../../studio/studio-state.js'
import { RoleForm } from './role-form.js'
import { FileForm } from './file-form.js'
import { DatabaseForm } from './database-form.js'
import { GroupForm, ProxyForm, StageForm } from './node-forms.js'
import { LinePanel, WorkflowForm } from './flow-forms.js'
import { AssetVersions } from './asset-versions.js'

export interface InspectorProps {
  copy: Dict
  open: boolean
  width: number
  editorData: EditorData | null
  presets: Array<{ id: string; name?: string }>
  tools: unknown[]
  models: Array<{ provider: string; model: string; efforts?: Array<{ id: string; name: string }> }>
  combos: Array<{ id: string; name: string; tools?: string[]; mcpServers?: string[] }>
  flowMeta: { nodeCount: number; revision: number }
  onPatch(patch: Record<string, unknown>): void
  onDelete(): void
  onSave(): void
  /** 图2 交互改造：实例 → 模板（另存为模板；用户裁决提供入口）。 */
  onSaveAsTemplate?(): void
  /** 模版 → 资产入库（工作流模版 / 角色模版；先保存模版，失败即中止）。 */
  onPromote?(): void
  /** 入库按钮锁定：已入库且模版内容未再修改（纯函数判定由调用方给出）。 */
  promoteLocked?: boolean
  /** 打开资产版本上拉列表（资产态回滚选择）。 */
  onOpenVersions?(): void
  /** 回滚 Active 指针到所选历史版本。 */
  onRollbackVersion?(versionId: number): void
  /** 收起版本列表（清空版本数据面）。 */
  onCloseVersions?(): void
  /** 已装载的版本列表（null = 未打开/装载中）。 */
  assetVersions?: StudioState['assetVersions']
  onCopyProxy(): void
  onRemoveMember(memberId: string): void
  onFileSelect(files: File[]): void
  onLoadMd(): void
  /** 协作 Prompt 从 .md 加载（与角色 System Prompt 一致）。 */
  onLoadGroupMd(): void
  onTestDb(): void
  saveDisabled: boolean
  importBusy: boolean
}

export function Inspector(props: InspectorProps) {
  const {
    copy: t, open, width, editorData, presets, tools, models, combos, flowMeta,
    onPatch, onDelete, onSave, onSaveAsTemplate, onPromote, promoteLocked, onOpenVersions, onRollbackVersion, onCloseVersions, assetVersions,
    onCopyProxy, onRemoveMember, onFileSelect, onLoadMd, onLoadGroupMd, onTestDb,
    saveDisabled, importBusy,
  } = props
  void tools
  // 版本上拉列表的展开/收起属瞬时渲染态（数据面在状态机；收起不丢业务事实）。
  // 记住「为哪个资产展开」：切换编辑对象后列表自动视为收起，避免展示上一个资产的版本。
  const [versionsAssetId, setVersionsAssetId] = useState<string | null>(null)

  let content: React.ReactNode
  if (!editorData) {
    content = <div className="wf-empty">{t.inspectorEmpty}</div>
  } else {
    const data = editorData.data
    switch (editorData.kind) {
      case 'workflow':
      case 'service':
        content = <WorkflowForm data={data} copy={t} isService={editorData.kind === 'service'} flowMeta={flowMeta} onPatch={onPatch} />
        break
      case 'role':
        // 父代理属性（D-20）：**模板层全面可编辑**（含 presetId/工具组合），不再显示
        // 「父代理模板无独立属性」空态；画布上的父代理节点同样可编辑，但运行期 preset
        // 仍按引擎口径固定 —— 故只有「模板来源」的编辑才放开组合(preset)下拉。
        content = (
          <RoleForm
            data={data}
            copy={t}
            presets={presets}
            models={models}
            combos={combos}
            onPatch={onPatch}
            onLoadMd={onLoadMd}
            isParent={editorData.isParent === true}
            allowCombos={editorData.isParent !== true || editorData.template === true}
          />
        )
        break
      case 'file':
        content = <FileForm data={data} copy={t} onPatch={onPatch} onFileSelect={onFileSelect} />
        break
      case 'database':
        content = <DatabaseForm data={data} copy={t} onPatch={onPatch} onTest={onTestDb} />
        break
      case 'group':
        content = <GroupForm data={data} copy={t} members={editorData.members} onPatch={onPatch} onLoadMd={onLoadGroupMd} onRemoveMember={onRemoveMember} />
        break
      case 'stage':
        content = <StageForm data={data} copy={t} nodeLabel={String(data.label ?? '')} />
        break
      case 'proxy':
        content = <ProxyForm data={data} copy={t} onPatch={onPatch} mainLabel={editorData.mainLabel ?? ''} />
        break
      case 'edge':
        content = <LinePanel data={data} copy={t} onPatch={onPatch} />
        break
      default:
        content = <div className="wf-empty">{t.inspectorEmpty}</div>
    }
  }

  // 底部按钮规则（所见即所操作）
  /**
   * 可回滚对象 id：资产自身（属性栏编辑的资产），或**画布角色节点**绑定的来源角色资产。
   * 画布节点是该资产的画布内联副本（data.sourceAssetId 是绑定事实），批注要求它与左侧栏
   * 角色资产具备同样的回滚能力；未绑定来源资产的内联节点没有版本可回滚，故不显示回滚按钮。
   * 计算放在渲染分支之外：版本列表的显示判据也要用它。
   */
  const nodeSourceAssetId = editorData?.sourceAssetId ?? ''
  const rollbackAssetId = (editorData?.assetId ?? '') !== '' ? editorData!.assetId! : nodeSourceAssetId

  const footer: React.ReactNode[] = []
  if (editorData) {
    const kind = editorData.kind
    const isStage = kind === 'stage'
    // 资产态（工作流资产 / 角色资产）：保存 = 登记新版本、归档 = 移出活跃复用面、回滚 = 版本列表
    const isAsset = editorData.asset === true || editorData.roleAsset === true
    const assetId = editorData.assetId ?? ''
    const canRollback = rollbackAssetId !== ''
      && (isAsset || (kind === 'role' && editorData.template !== true && nodeSourceAssetId !== ''))
    // 展开态只在「仍编辑着同一个回滚对象」时成立（编辑器切换即自动收起）
    const versionsOpen = versionsAssetId !== null && versionsAssetId === rollbackAssetId
    // 复制按钮：画布角色节点（含父代理节点，§4.2.3.1 规则 3 可创建虚拟节点）；
    // 模板与父代理模板不可复制，角色资产（不在画布上）同样不可复制
    const canCopyProxy = kind === 'role' && !editorData.template && !isAsset
    // 入库：仅工作流模版与角色模版（文件/数据库/协作组模板不显示；资产态隐藏）
    const canPromote = !isAsset && editorData.template === true && (kind === 'workflow' || kind === 'role') && onPromote !== undefined
    if (!isStage) {
      footer.push(
        <button key="save" type="button" className="wf-btn is-primary" onClick={onSave} disabled={importBusy || saveDisabled}>
          {t.inspectorSave}
        </button>,
      )
    }
    footer.push(
      // 资产态的删除按钮语义是「归档」（Active 移除、历史与版本内容全保留，绝不删除版本行）；
      // 历史（已归档）资产的归档按钮置灰：归档只能生效一次，且不提供任何删除入口
      <button
        key="delete"
        type="button"
        className="wf-btn is-danger"
        onClick={onDelete}
        disabled={importBusy || (isAsset && editorData.retired === true)}
        title={isAsset ? t.assetArchiveHint : undefined}
      >
        {isAsset ? t.assetArchive : t.inspectorDelete}
      </button>,
    )
    if (canPromote) {
      footer.push(
        <button
          key="promote"
          type="button"
          className="wf-btn"
          onClick={onPromote}
          disabled={importBusy || promoteLocked === true}
          title={promoteLocked === true ? t.assetPromoteLockedHint : t.assetPromoteHint}
        >
          {t.assetPromote}
        </button>,
      )
    }
    // 回滚（展开版本列表）：资产态与「绑定来源资产的画布角色节点」都显示；模版态不显示
    if (canRollback && onOpenVersions) {
      footer.push(
        <button
          key="rollback"
          type="button"
          className="wf-btn"
          onClick={() => {
            if (versionsOpen) {
              setVersionsAssetId(null)
              onCloseVersions?.()
              return
            }
            setVersionsAssetId(rollbackAssetId)
            onOpenVersions()
          }}
          disabled={importBusy}
        >
          {t.assetRollback}
        </button>,
      )
    }
    if (canCopyProxy) {
      footer.push(
        <button key="copy" type="button" className="wf-btn" onClick={onCopyProxy} disabled={importBusy}>
          {t.inspectorCopy}
        </button>,
      )
    }
    // 图2 交互改造：实例态（工作流/服务实例）提供「另存为模板」——当前实例内容
    // 复制为全局共享的工作流模板（模板库 + 号也能新建空白模板，二者均可）。
    if ((kind === 'workflow' || kind === 'service') && !editorData.template && !isAsset && onSaveAsTemplate) {
      footer.push(
        <button key="save-as-template" type="button" className="wf-btn" onClick={onSaveAsTemplate} disabled={importBusy}>
          {String(t.saveAsTemplate)}
        </button>,
      )
    }
  }

  const showVersions = versionsAssetId !== null && rollbackAssetId !== '' && versionsAssetId === rollbackAssetId
    && (editorData?.asset === true || editorData?.roleAsset === true || editorData?.sourceAssetId !== undefined)

  return (
    <aside className={`wf-inspector${open ? '' : ' is-collapsed'}`} style={{ width: open ? width : undefined }}>
      <div className="wf-inspector__scroll">{content}</div>
      {footer.length > 0
        ? (
            <div className="wf-inspector__footer">
              {footer}
              {showVersions
                ? (
                    <AssetVersions
                      copy={t}
                      versions={assetVersions ?? null}
                      assetId={rollbackAssetId}
                      onClose={() => { setVersionsAssetId(null); onCloseVersions?.() }}
                      onRollback={(versionId) => { setVersionsAssetId(null); onRollbackVersion?.(versionId) }}
                    />
                  )
                : null}
            </div>
          )
        : null}
    </aside>
  )
}

