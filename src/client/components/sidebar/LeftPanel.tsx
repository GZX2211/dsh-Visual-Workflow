// src/client/components/sidebar/LeftPanel.tsx
//
// 左侧模板库（照搬旧项目 left-panel.js，TSX 化，按需求 §4.5.4 适配）：
// 四 Tag：工作流 / 角色（父代理模板置顶）/ 数据（文件 + 数据库分区）/ 其他（阶段 + 协作组）。
// 本次改动：四 Tag 由文字改为「图标」展示（图片批注：Tag 区以图标显示，不显示文字，
// 共 4 个 tag；切换到不同 Tag 时下方列表内容随动，适配角色/数据/其他节点）。
// 内容构建已提取到 library-model.ts（与底栏 BottomPanel 共用同一 builder，逻辑一致）。
//
// 资产态改造（用户裁决）：四个 Tag 之下常驻搜索栏；列表之后（左栏底部）新增
// 「模版 / 资产」来源切换——切换同时切左侧库来源与画布文档类型。

import { useState } from 'react'
import type { Dict } from '../../i18n.js'
import type { LibTab, LibrarySource } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'
import type { RoleAssetSummary, WorkflowAssetSummary } from '../../../host/shared/asset-types.js'
import { statusLabelOf } from '../../lib/status-label.js'
import { ASSET_HISTORY_SECTIONS, buildLibraryModel } from './library-model.js'

// 以下类型由本文件导出（供 useLibraryDrag/library-model 等消费，保持既有导入路径不变）。
export interface LibSelectionInfo {
  kind: 'workflow' | 'workflowTemplate' | 'flowAsset' | 'roleAsset' | 'role' | 'file' | 'database' | 'parentTemplate' | 'stage' | 'groupTemplate' | 'service'
  id: string
}

export interface DragPayload {
  label: string
  onClick(): void
  /**
   * 拖入画布落点回调。缺省 = 该卡片不可拖入画布（历史（已归档）资产：拖入等于让
   * 归档资产重新进入编排，必须先经属性栏「回滚」显式启用）。
   */
  onDrop?(position?: { x: number; y: number }): void
  /** 拖拽落点为协作组卡片时：生成节点并直接入组（角色模板）。 */
  onDropIntoGroup?(groupId: string, position?: { x: number; y: number }): void
}

export interface LeftPanelProps {
  copy: Dict
  libTab: LibTab
  onSetTab(tab: LibTab): void
  /** 库来源（模版 / 资产）与切换回调。 */
  librarySource: LibrarySource
  onSetLibrarySource(source: LibrarySource): void
  /** 搜索关键词（两态共用）与输入回调。 */
  libSearch: string
  onSetLibSearch(query: string): void
  open: boolean
  width: number
  mode: 'mode1' | 'mode2'
  /** 实例列表（工作台全局化：全部会话实例；每项带 sessionId 供归属判定）。
   * runStatus 为 null 表示无活跃 run（不显示徽标）。 */
  workflows: Array<{ id: string; name: string; description?: string; nodes?: unknown[]; runStatus?: string | null; sessionId?: string }>
  /** 当前主会话 id（会话树根）：实例列表中 sessionId 与之匹配的实例打「当前」标签。 */
  currentSessionId: string
  /** 工作流模板列表（全局共享；按当前 mode 过滤后传入；图2 交互改造）。 */
  flowTemplates: WorkflowTemplate[]
  /** 资产列表（活跃 + 历史（已归档）；资产态左栏数据源）。 */
  assets: {
    workflows: WorkflowAssetSummary[]
    roles: RoleAssetSummary[]
    retiredWorkflows: WorkflowAssetSummary[]
    retiredRoles: RoleAssetSummary[]
  }
  parentTemplate: RoleTemplate | null
  roleTemplates: RoleTemplate[]
  fileTemplates: FileTemplate[]
  databaseTemplates: DatabaseTemplate[]
  /** 协作组模板列表（全局共享；「其他」Tab 协作组分区，用户批注：+ 新增/点击编辑/删除）。 */
  groupTemplates: GroupTemplate[]
  stageKinds: Array<{ kind: string; label: string }>
  libSelection: LibSelectionInfo | null
  modeName(presetId: string | null | undefined): string
  onSelectWorkflow(id: string): void
  onSelectFlowTemplate(id: string): void
  /** 打开工作流资产为画布文档（资产态）。 */
  onSelectFlowAsset(id: string): void
  /** 打开角色资产（属性栏编辑）。 */
  onOpenRoleAsset(id: string): void
  /** 角色资产拖入画布。 */
  onPlaceRoleAsset(id: string, position: { x: number; y: number }): void
  onSelectLib(kind: LibSelectionInfo['kind'], id: string): void
  onPlaceTemplate(kind: 'role' | 'file' | 'database', id: string, position: { x: number; y: number }): void
  /** 角色模板拖入协作组：生成节点并直接入组。 */
  onPlaceTemplateIntoGroup(kind: 'role', id: string, groupId: string, position: { x: number; y: number }): void
  onPlaceStage(kind: string, position: { x: number; y: number }): void
  onPlaceGroup(position: { x: number; y: number }): void
  /** 协作组模板拖入画布：按模板内容生成协作组节点。 */
  onPlaceGroupFromTemplate(id: string, position: { x: number; y: number }): void
  onPlaceParent(id: string, position: { x: number; y: number }): void
  onCreateNew(tab: LibTab, section?: 'file' | 'database' | 'flowTemplate' | 'group'): void
  onBeginDrag(event: React.PointerEvent, payload: DragPayload): void
}

/** 库来源切换标签（模版 / 资产；两个标签，is-active 切状态）。 */
const SOURCE_DEFS: Array<{ key: LibrarySource; labelKey: 'libSourceTemplate' | 'libSourceAsset' }> = [
  { key: 'template', labelKey: 'libSourceTemplate' },
  { key: 'asset', labelKey: 'libSourceAsset' },
]

export function LeftPanel(props: LeftPanelProps) {
  const {
    copy: t, libTab, onSetTab, librarySource, onSetLibrarySource, libSearch, onSetLibSearch,
    open, width, onCreateNew, onBeginDrag,
  } = props

  /**
   * 分栏折叠态（纯渲染态，属组件本地状态）：历史资产分栏默认折叠，用户可手动展开。
   * 不做持久化——折叠是「这次的查看方式」，把它写进业务状态会让状态机承担界面呈现细节。
   */
  const [collapsedSections, setCollapsedSections] = useState<readonly string[]>(() => [
    ASSET_HISTORY_SECTIONS.workflow,
    ASSET_HISTORY_SECTIONS.role,
  ])
  const toggleSection = (key: string): void => {
    setCollapsedSections((previous) => (previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]))
  }

  const model = buildLibraryModel({ ...props, collapsedSections })

  return (
    <aside className={`wf-docrail${open ? '' : ' is-collapsed'}`} style={{ width: open ? width : undefined }}>
      <div className="wf-lib-tabs" role="tablist">
        {model.tabs.map((def) => (
          <button
            key={def.key}
            type="button"
            role="tab"
            title={def.label}
            aria-label={def.label}
            className={`wf-lib-tab${libTab === def.key ? ' is-active' : ''}`}
            onClick={() => onSetTab(def.key)}
          >
            <span>{def.label}</span>
          </button>
        ))}
      </div>
      {/* 搜索栏：常驻两态（模版 / 资产），共用同一关键词；过滤当前 Tab 下全部分区卡片 */}
      <div className="wf-lib-search">
        <input
          type="search"
          className="wf-lib-search__input"
          aria-label={t.libSearchAria}
          placeholder={t.libSearchPlaceholder}
          value={libSearch}
          onChange={(event) => onSetLibSearch(event.target.value)}
        />
      </div>
      <div className="wf-docrail__list">
        {model.emptyHint ? <div className="wf-hint">{model.emptyHint}</div> : null}
        {model.sections.map((section) => (
          <div key={section.key}>
            <div className="wf-docgroup">
              {section.collapsible
                ? (
                    <button
                      type="button"
                      className={`wf-docgroup__toggle${section.collapsed ? ' is-collapsed' : ''}`}
                      aria-expanded={section.collapsed !== true}
                      title={section.collapsed ? t.libSectionExpand : t.libSectionCollapse}
                      onClick={() => toggleSection(section.key)}
                    >
                      <span className="wf-docgroup__caret" aria-hidden="true" />
                      <span>{section.title}</span>
                      {/* 折叠时给出命中数：搜索过滤照常生效，用户据此知道要不要展开 */}
                      {section.collapsed === true && section.cards.length > 0
                        ? <span className="wf-docgroup__count">{section.cards.length}</span>
                        : null}
                    </button>
                  )
                : <span>{section.title}</span>}
              {section.plus
                ? <button type="button" className="wf-docgroup__add" title={t.newTemplate} onClick={() => onCreateNew(libTab, section.plusKind)}>＋</button>
                : null}
            </div>
            {section.collapsed === true
              ? null
              : section.cards.length === 0
                ? <div className="wf-hint" style={{ padding: '2px 8px' }}>{section.emptyText}</div>
                : section.cards.map((item) => {
                    const statusText = statusLabelOf(t, item.runStatus)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`wf-docitem${item.pinned ? ' is-pinned' : ''}${item.active ? ' is-active' : ''}`}
                        onPointerDown={(event) => onBeginDrag(event, item.payload)}
                      >
                        <span className="wf-docitem__icon">{item.icon}</span>
                        <span className="wf-docitem__texts">
                          <span className="wf-docitem__title-row">
                            <span className="wf-docitem__label">{item.name}</span>
                            {item.isCurrent ? <span className="wf-docitem__badge is-current">{t.currentSessionBadge}</span> : null}
                          </span>
                          <span className="wf-docitem__path">{item.sub}</span>
                        </span>
                        {statusText ? <span className="wf-docitem__badge">{statusText}</span> : null}
                      </button>
                    )
                  })}
          </div>
        ))}
      </div>
      {/* 来源切换：左栏底部（列表之后）。切换 = 左侧库来源 + 画布文档类型（由 Studio 编排） */}
      <div className="wf-lib-source" role="tablist" aria-label={t.libSourceAria}>
        {SOURCE_DEFS.map((def) => (
          <button
            key={def.key}
            type="button"
            role="tab"
            aria-selected={librarySource === def.key}
            className={`wf-lib-source__tab${librarySource === def.key ? ' is-active' : ''}`}
            onClick={() => onSetLibrarySource(def.key)}
          >
            {t[def.labelKey]}
          </button>
        ))}
      </div>
    </aside>
  )
}
