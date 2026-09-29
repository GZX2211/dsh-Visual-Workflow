// src/client/components/sidebar/BottomPanel.tsx
//
// 底栏（图片批注新增）：与左侧栏相互切换的「横向库面板」，用于优化界面空间。
// 与左栏共用 library-model.ts 的同一 builder（内容/选中/拖拽逻辑完全一致），
// 仅显示布局不同——本次按要求改为：卡片只显示名称（不再显示描述、图标等）。
//
// Tag 区（底栏最左，竖向）显示 工作流/角色/数据/其他 四个图标（不显示文字，共 4 个 tag）；
// 切换到不同 Tag 时，右侧卡片列表随动（实例/模板、角色模板、文件/数据库、阶段/协作组）。
// 卡片横向排列、flex-wrap 自动换行：单排放不下时动态追加下一排（底栏够宽可无限追加排）。
// 卡片支持拖拽入画布（与左栏一致，经 onBeginDrag）。
//
// 资产态（用户裁决）：卡片内容随「库来源」切换（来源切换入口在左栏底部）；
// 搜索栏与左栏共用同一关键词——两处显示的过滤结果始终一致。

import type { Dict } from '../../i18n.js'
import type { LibTab, LibrarySource } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'
import type { ExperienceEntry, RoleAssetSummary, WorkflowAssetSummary } from '../../../host/shared/asset-types.js'
import { buildLibraryModel } from './library-model.js'
import type { DragPayload, LibSelectionInfo } from './LeftPanel.js'

export interface BottomPanelProps {
  copy: Dict
  libTab: LibTab
  onSetTab(tab: LibTab): void
  /** 库来源（模版 / 资产）：只读消费（切换入口在左栏底部）。 */
  librarySource: LibrarySource
  onSetLibrarySource(source: LibrarySource): void
  libSearch: string
  onSetLibSearch(query: string): void
  open: boolean
  height: number
  mode: 'mode1' | 'mode2'
  workflows: Array<{ id: string; name: string; description?: string; nodes?: unknown[]; runStatus?: string | null; sessionId?: string }>
  currentSessionId: string
  flowTemplates: WorkflowTemplate[]
  assets: {
    workflows: WorkflowAssetSummary[]
    roles: RoleAssetSummary[]
    retiredWorkflows: WorkflowAssetSummary[]
    retiredRoles: RoleAssetSummary[]
  }
  /** 经验列表（资产态「数据」Tag 以「经验」呈现；活跃与已归档一并传入）。 */
  experiences: ExperienceEntry[]
  parentTemplate: RoleTemplate | null
  roleTemplates: RoleTemplate[]
  fileTemplates: FileTemplate[]
  databaseTemplates: DatabaseTemplate[]
  groupTemplates: GroupTemplate[]
  stageKinds: Array<{ kind: string; label: string }>
  libSelection: LibSelectionInfo | null
  modeName(presetId: string | null | undefined): string
  onSelectWorkflow(id: string): void
  onSelectFlowTemplate(id: string): void
  onSelectFlowAsset(id: string): void
  onOpenRoleAsset(id: string): void
  /** 打开经验（资产态属性栏编辑；经验没有画布形态，故无拖入入口）。 */
  onOpenExperience(id: string): void
  onPlaceRoleAsset(id: string, position: { x: number; y: number }): void
  onSelectLib(kind: LibSelectionInfo['kind'], id: string): void
  onPlaceTemplate(kind: 'role' | 'file' | 'database', id: string, position: { x: number; y: number }): void
  onPlaceTemplateIntoGroup(kind: 'role', id: string, groupId: string, position: { x: number; y: number }): void
  onPlaceStage(kind: string, position: { x: number; y: number }): void
  onPlaceGroup(position: { x: number; y: number }): void
  onPlaceGroupFromTemplate(id: string, position: { x: number; y: number }): void
  onPlaceParent(id: string, position: { x: number; y: number }): void
  onCreateNew(tab: LibTab, section?: 'file' | 'database' | 'flowTemplate' | 'group'): void
  onBeginDrag(event: React.PointerEvent, payload: DragPayload): void
}

export function BottomPanel(props: BottomPanelProps) {
  const {
    copy: t, libTab, onSetTab, libSearch, onSetLibSearch, open, height, onCreateNew, onBeginDrag,
  } = props

  const model = buildLibraryModel(props)

  return (
    <aside className={`wf-bottombar${open ? '' : ' is-collapsed'}`} style={{ height: open ? height : undefined }}>
      {/* Tag 区：工作流/角色/数据/其他 横向文字（不显示图标）；切换时下方卡片随动 */}
      <div className="wf-bottombar__tags" role="tablist">
        {model.tabs.map((def) => (
          <button
            key={def.key}
            type="button"
            role="tab"
            title={def.label}
            aria-label={def.label}
            className={`wf-bottombar__tag${libTab === def.key ? ' is-active' : ''}`}
            onClick={() => onSetTab(def.key)}
          >
            {def.label}
          </button>
        ))}
      </div>

      {/* 卡片区：搜索栏 + 分区（标题 + 横向换行卡片流）；与左栏共用同一关键词 */}
      <div className="wf-bottombar__scroll">
        <div className="wf-lib-search wf-lib-search--bottom">
          <input
            type="search"
            className="wf-lib-search__input"
            aria-label={t.libSearchAria}
            placeholder={t.libSearchPlaceholder}
            value={libSearch}
            onChange={(event) => onSetLibSearch(event.target.value)}
          />
        </div>
        {model.emptyHint ? <div className="wf-hint">{model.emptyHint}</div> : null}
        {model.sections.map((section) => (
          <div key={section.key} className="wf-bottombar__section">
            <div className="wf-bottombar__group">
              <span className="wf-bottombar__group-title">{section.title}</span>
              {section.plus
                ? <button type="button" className="wf-docgroup__add" title={t.newTemplate} onClick={() => onCreateNew(libTab, section.plusKind)}>＋</button>
                : null}
            </div>
            {section.cards.length === 0
              ? <div className="wf-hint">{section.emptyText}</div>
              : (
                  <div className="wf-bottombar__cards">
                    {section.cards.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`wf-hcard${item.active ? ' is-active' : ''}`}
                        onPointerDown={(event) => onBeginDrag(event, item.payload)}
                      >
                        <span className="wf-hcard__name">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
          </div>
        ))}
      </div>
    </aside>
  )
}
