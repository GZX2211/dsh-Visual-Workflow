// src/client/components/sidebar/LeftPanel.tsx
//
// 左侧模板库（照搬旧项目 left-panel.js，TSX 化，按需求 §4.5.4 适配）：
// 四 Tag：工作流 / 角色（父代理模板置顶）/ 数据（文件 + 数据库分区）/ 其他（阶段 + 协作组）。
// 本次改动：四 Tag 由文字改为「图标」展示（图片批注：Tag 区以图标显示，不显示文字，
// 共 4 个 tag；切换到不同 Tag 时下方列表内容随动，适配角色/数据/其他节点）。
// 内容构建已提取到 library-model.ts（与底栏 BottomPanel 共用同一 builder，逻辑一致）。

import type { Dict } from '../../i18n.js'
import type { LibTab } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'
import { buildLibraryModel } from './library-model.js'

// 以下类型由本文件导出（供 useLibraryDrag/library-model 等消费，保持既有导入路径不变）。
export interface LibSelectionInfo {
  kind: 'workflow' | 'workflowTemplate' | 'role' | 'file' | 'database' | 'parentTemplate' | 'stage' | 'groupTemplate' | 'service'
  id: string
}

export interface DragPayload {
  label: string
  onClick(): void
  onDrop(position?: { x: number; y: number }): void
  /** 拖拽落点为协作组卡片时：生成节点并直接入组（角色模板）。 */
  onDropIntoGroup?(groupId: string, position?: { x: number; y: number }): void
}

export interface LeftPanelProps {
  copy: Dict
  libTab: LibTab
  onSetTab(tab: LibTab): void
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

export function LeftPanel(props: LeftPanelProps) {
  const {
    copy: t, libTab, onSetTab, open, width, onCreateNew, onBeginDrag,
  } = props

  const model = buildLibraryModel(props)

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
      <div className="wf-docrail__list">
        {model.sections.map((section) => (
          <div key={section.key}>
            <div className="wf-docgroup">
              <span>{section.title}</span>
              {section.plus
                ? <button type="button" className="wf-docgroup__add" title={t.newTemplate} onClick={() => onCreateNew(libTab, section.plusKind)}>＋</button>
                : null}
            </div>
            {section.cards.length === 0
              ? <div className="wf-hint" style={{ padding: '2px 8px' }}>{t.libEmptyTemplates}</div>
              : section.cards.map((item) => {
                  const statusText = item.runStatus ? String((t.status as Record<string, string>)[item.runStatus] ?? '') : ''
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`wf-docitem${item.pinned ? ' is-pinned' : ''}${item.active ? ' is-active' : ''}`}
                      onPointerDown={(event) => onBeginDrag(event, item.payload)}
                    >
                      <span className="wf-docitem__icon">{item.icon}</span>
                      <span>
                        <span className="wf-docitem__label">{item.name}</span>
                        {/* 工作台全局化：当前主会话对应的实例打「当前」标签（用于区分跨会话实例） */}
                        {item.isCurrent ? <span className="wf-docitem__badge is-current">{t.currentSessionBadge}</span> : null}
                        <span className="wf-docitem__path">{item.sub}</span>
                      </span>
                      {statusText ? <span className="wf-docitem__badge">{statusText}</span> : null}
                    </button>
                  )
                })}
          </div>
        ))}
      </div>
    </aside>
  )
}
