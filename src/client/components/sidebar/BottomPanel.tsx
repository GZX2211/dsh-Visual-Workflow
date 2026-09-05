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

import type { Dict } from '../../i18n.js'
import type { LibTab } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'
import { buildLibraryModel } from './library-model.js'
import type { DragPayload, LibSelectionInfo } from './LeftPanel.js'

export interface BottomPanelProps {
  copy: Dict
  libTab: LibTab
  onSetTab(tab: LibTab): void
  open: boolean
  height: number
  mode: 'mode1' | 'mode2'
  workflows: Array<{ id: string; name: string; description?: string; nodes?: unknown[]; runStatus?: string | null; sessionId?: string }>
  currentSessionId: string
  flowTemplates: WorkflowTemplate[]
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
    copy: t, libTab, onSetTab, open, height, onCreateNew, onBeginDrag,
  } = props

  const model = buildLibraryModel(props)

  return (
    <aside className={`wf-bottombar${open ? '' : ' is-collapsed'}`} style={{ height: open ? height : undefined }}>
      {/* Tag 区：工作流/角色/数据/其他 四图标（竖向；不显示文字） */}
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
            <span className="wf-bottombar__tag-icon" aria-hidden="true">{def.icon}</span>
          </button>
        ))}
      </div>

      {/* 卡片区：分区（标题 + 横向换行卡片流） */}
      <div className="wf-bottombar__scroll">
        {model.sections.map((section) => (
          <div key={section.key} className="wf-bottombar__section">
            <div className="wf-bottombar__group">
              <span className="wf-bottombar__group-title">{section.title}</span>
              {section.plus
                ? <button type="button" className="wf-docgroup__add" title={t.newTemplate} onClick={() => onCreateNew(libTab, section.plusKind)}>＋</button>
                : null}
            </div>
            {section.cards.length === 0
              ? <div className="wf-hint">{t.libEmptyTemplates}</div>
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
