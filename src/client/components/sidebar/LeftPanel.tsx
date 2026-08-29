// src/client/components/sidebar/LeftPanel.tsx
//
// 左侧模板库（照搬旧项目 left-panel.js，TSX 化，按需求 §4.5.4 适配）：
// 四 Tab：工作流 / 角色（父代理模板置顶）/ 数据（文件 + 数据库分区）/ 其他（阶段 + 协作组）；
// 分区标题右侧 ＋ 新建空白模板；卡片支持 pointer 拖拽到画布生成节点。

import type { Dict } from '../../i18n.js'
import type { LibTab } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'

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
  workflows: Array<{ id: string; name: string; description?: string; nodes?: unknown[]; running?: boolean }>
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

function truncate(value: unknown, limit: number): string {
  const text = String(value ?? '').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : (text || '—')
}

/** 角色模板卡副行：System Prompt 截断展示（需求 §4.2.3.1：不可编辑，超过 20 字截断；
 *  从 .md 加载时显示所选 .md 文件名——用户验收标注）。 */
function roleSubline(template: RoleTemplate): string {
  const source = String((template as { systemPromptSource?: unknown }).systemPromptSource ?? '').trim()
  if (source) return source
  return truncate(String(template.systemPrompt ?? ''), 20)
}

/** 文件模板卡副行：文本类型显示内容（单行省略）；文件类型显示所选文件名列表
 *  （保留中文文件名；超出单行省略）——用户验收标注。 */
function fileSubline(template: FileTemplate): string {
  if (template.fileKind === 'file') {
    const files = Array.isArray(template.files) && template.files.length > 0
      ? template.files.map((item) => String(item?.fileName ?? '')).filter(Boolean)
      : [String(template.fileName ?? '')].filter(Boolean)
    return truncate(files.join('，'), 60)
  }
  return truncate(String(template.content ?? ''), 60)
}

export function LeftPanel(props: LeftPanelProps) {
  const {
    copy: t, libTab, onSetTab, open, width, mode, workflows, flowTemplates, parentTemplate,
    roleTemplates, fileTemplates, databaseTemplates, groupTemplates, stageKinds, libSelection,
    modeName, onSelectWorkflow, onSelectFlowTemplate, onSelectLib, onPlaceTemplate, onPlaceTemplateIntoGroup, onPlaceStage,
    onPlaceGroup, onPlaceGroupFromTemplate, onPlaceParent, onCreateNew, onBeginDrag,
  } = props

  const tabDefs: Array<{ key: LibTab; label: string }> = [
    { key: 'workflow', label: t.libTab.workflow },
    { key: 'role', label: t.libTab.role },
    { key: 'data', label: t.libTab.data },
    { key: 'other', label: t.libTab.other },
  ]

  const isActive = (kind: string, id: string): boolean => libSelection?.kind === kind && libSelection?.id === id

  function itemCard(key: string, kind: string, id: string, icon: string, name: string, sub: string, payload: DragPayload, pinned = false, running = false) {
    return (
      <button
        key={key}
        type="button"
        className={`wf-docitem${pinned ? ' is-pinned' : ''}${isActive(kind, id) ? ' is-active' : ''}`}
        onPointerDown={(event) => onBeginDrag(event, payload)}
      >
        <span className="wf-docitem__icon">{icon}</span>
        <span>
          <span className="wf-docitem__label">{name}</span>
          <span className="wf-docitem__path">{sub}</span>
        </span>
        {running ? <span className="wf-docitem__badge">{t.instanceRunning}</span> : null}
      </button>
    )
  }

  const sections: Array<{ key: string; title: string; plus: boolean; plusKind?: 'file' | 'database' | 'flowTemplate' | 'group'; cards: React.ReactNode[] }> = []

  if (libTab === 'workflow') {
    // 图2 交互改造：左侧「工作流」Tab 拆两区——上方实例列表（无 + 号；运行中卡片
    // 名称右侧显示运行状态），下方工作流模板列表（+ 号新建空白模板；全局共享）。
    const instances = (workflows ?? []).map((item) => itemCard(
      item.id, 'workflow', item.id, '▦', String(item.name ?? ''),
      item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes ?? ''}`,
      {
        label: String(item.name ?? ''),
        onClick: () => onSelectWorkflow(item.id),
        onDrop: () => onSelectWorkflow(item.id),
      },
      false,
      item.running === true,
    ))
    sections.push({ key: 'instances', title: t.flowInstances, plus: false, cards: instances })
    sections.push({
      key: 'flowTemplates',
      title: t.flowTemplates,
      plus: true,
      plusKind: 'flowTemplate',
      cards: (flowTemplates ?? []).map((item) => itemCard(
        item.id, 'workflowTemplate', item.id, '▦', String(item.name ?? ''),
        item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes ?? ''}`,
        {
          label: String(item.name ?? ''),
          onClick: () => onSelectFlowTemplate(item.id),
          onDrop: () => onSelectFlowTemplate(item.id),
        },
      )),
    })
  } else if (libTab === 'role') {
    if (parentTemplate) {
      sections.push({
        key: 'parent',
        title: t.parentAgent,
        plus: false,
        cards: [
          itemCard(
            parentTemplate.id, 'parentTemplate', parentTemplate.id, '父', String(parentTemplate.name ?? t.parentAgent),
            roleSubline(parentTemplate), {
              label: String(parentTemplate.name ?? t.parentAgent),
              onClick: () => onSelectLib('parentTemplate', parentTemplate.id),
              onDrop: (position) => onPlaceParent(parentTemplate.id, position ?? { x: 120, y: 80 }),
            }, true,
          ),
        ],
      })
    }
    sections.push({
      key: 'roles',
      title: t.roleTemplates,
      plus: true,
      cards: (roleTemplates ?? []).map((item) => itemCard(
        item.id, 'role', item.id, '◆', String(item.name ?? ''), roleSubline(item), {
          label: String(item.name ?? ''),
          onClick: () => onSelectLib('role', item.id),
          onDrop: (position) => onPlaceTemplate('role', item.id, position ?? { x: 120, y: 80 }),
          onDropIntoGroup: (groupId, position) => onPlaceTemplateIntoGroup('role', item.id, groupId, position ?? { x: 120, y: 80 }),
        },
      )),
    })
  } else if (libTab === 'data') {
    sections.push({
      key: 'files',
      title: t.files,
      plus: true,
      plusKind: 'file',
      cards: (fileTemplates ?? []).map((item) => itemCard(
        item.id, 'file', item.id, '▤', String(item.name ?? ''), fileSubline(item), {
          label: String(item.name ?? ''),
          onClick: () => onSelectLib('file', item.id),
          onDrop: (position) => onPlaceTemplate('file', item.id, position ?? { x: 120, y: 80 }),
        },
      )),
    })
    sections.push({
      key: 'databases',
      title: t.databases,
      plus: true,
      plusKind: 'database',
      cards: (databaseTemplates ?? []).map((item) => itemCard(
        item.id, 'database', item.id, '▦', String(item.name ?? ''), truncate(String(item.description ?? ''), 60), {
          label: String(item.name ?? ''),
          onClick: () => onSelectLib('database', item.id),
          onDrop: (position) => onPlaceTemplate('database', item.id, position ?? { x: 120, y: 80 }),
        },
      )),
    })
  } else {
    sections.push({
      key: 'stages',
      title: t.stages,
      plus: false,
      cards: (stageKinds ?? []).map((card) => itemCard(
        card.kind, 'stage', card.kind, '⬢', String(card.label), String(t.stagePinHint ?? ''), {
          label: String(card.label),
          onClick: () => onSelectLib('stage', card.kind),
          onDrop: (position) => onPlaceStage(card.kind, position ?? { x: 120, y: 80 }),
        },
      )),
    })
    sections.push({
      key: 'groups',
      title: t.groupTemplates,
      plus: true,
      plusKind: 'group',
      cards: (groupTemplates ?? []).map((item) => itemCard(
        item.id, 'groupTemplate', item.id, '☰', String(item.name ?? ''), truncate(String((item as { collabPrompt?: unknown }).collabPrompt ?? ''), 60), {
          label: String(item.name ?? ''),
          onClick: () => onSelectLib('groupTemplate', item.id),
          onDrop: (position) => onPlaceGroupFromTemplate(item.id, position ?? { x: 120, y: 80 }),
        },
      )),
    })
  }

  return (
    <aside className={`wf-docrail${open ? '' : ' is-collapsed'}`} style={{ width: open ? width : undefined }}>
      <div className="wf-lib-tabs" role="tablist">
        {tabDefs.map((def) => (
          <button
            key={def.key}
            type="button"
            role="tab"
            className={`wf-lib-tab${libTab === def.key ? ' is-active' : ''}`}
            onClick={() => onSetTab(def.key)}
          >
            <span>{def.label}</span>
          </button>
        ))}
      </div>
      <div className="wf-docrail__list">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="wf-docgroup">
              <span>{section.title}</span>
              {section.plus
                ? <button type="button" className="wf-docgroup__add" title={t.newTemplate} onClick={() => onCreateNew(libTab, section.plusKind)}>＋</button>
                : null}
            </div>
            {section.cards.length === 0
              ? <div className="wf-hint" style={{ padding: '2px 8px' }}>{t.libEmptyTemplates}</div>
              : section.cards}
          </div>
        ))}
      </div>
    </aside>
  )
}
