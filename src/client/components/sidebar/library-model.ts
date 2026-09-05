// src/client/components/sidebar/library-model.ts
//
// 库内容模型构建器（纯函数，无副作用）：把「左侧库」的完整逻辑（四 Tag 分区、
// 实例/模板/角色/文件/数据库/阶段/协作组卡片、拖拽 payload、选中高亮判定）
// 提取为一份可复用的数据模型。左侧栏（LeftPanel，竖向列表）与底栏（BottomPanel，
// 横向卡片流）共用同一 builder，保证两份显示的「内容与选中/拖拽逻辑」完全一致——
// 本次仅改显示布局与交互，不涉及任何后端/数据改动。
//
// 单一职责：本文件只负责「从原始列表 + 回调构造卡片模型」，不渲染任何 JSX。

import type { Dict } from '../../i18n.js'
import type { LibTab, LibSelKind } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'
import type { DragPayload, LibSelectionInfo } from './LeftPanel.js'

/** 单张卡片模型（拖拽 payload + 展示字段；底栏只取 name，左栏取全部）。 */
export interface LibraryCardModel {
  key: string
  kind: LibSelKind
  id: string
  icon: string
  name: string
  sub: string
  pinned?: boolean
  runStatus?: string | null
  isCurrent?: boolean
  active: boolean
  payload: DragPayload
}

/** 分区模型（标题 + 是否显示「＋」新建 + 卡片列表）。 */
export interface LibrarySectionModel {
  key: string
  title: string
  plus: boolean
  plusKind?: 'file' | 'database' | 'flowTemplate' | 'group'
  cards: LibraryCardModel[]
}

/** Tag 模型（工作流/角色/数据/其他；图标化显示）。 */
export interface LibraryTabModel {
  key: LibTab
  label: string
  icon: string
}

/** 库内容模型（Tab 列表 + 当前 Tag 下的分区列表）。 */
export interface LibraryModel {
  tabs: LibraryTabModel[]
  sections: LibrarySectionModel[]
}

/** builder 输入：原始列表 + 选区 + 全部回调（与 LeftPanel props 高度重合）。 */
export interface LibraryModelInput {
  copy: Dict
  libTab: LibTab
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
}

/** 四 Tag（与左栏一致；底栏以图标展示）。 */
const TAB_DEFS: Array<{ key: LibTab; label: string; icon: string }> = [
  { key: 'workflow', label: '工作流', icon: '▦' },
  { key: 'role', label: '角色', icon: '◆' },
  { key: 'data', label: '数据', icon: '▤' },
  { key: 'other', label: '其他', icon: '⋯' },
]

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

/** 构造库内容模型（纯函数；不渲染，不读 DOM/时钟）。 */
export function buildLibraryModel(input: LibraryModelInput): LibraryModel {
  const {
    copy: t, libTab, workflows, currentSessionId, flowTemplates, parentTemplate,
    roleTemplates, fileTemplates, databaseTemplates, groupTemplates, stageKinds, libSelection,
    onSelectWorkflow, onSelectFlowTemplate, onSelectLib, onPlaceTemplate,
    onPlaceTemplateIntoGroup, onPlaceStage, onPlaceGroupFromTemplate, onPlaceParent, onCreateNew,
  } = input

  const isActive = (kind: string, id: string): boolean => libSelection?.kind === kind && libSelection?.id === id

  function card(
    key: string, kind: LibSelKind, id: string, icon: string, name: string, sub: string,
    payload: DragPayload, pinned = false, runStatus?: string | null, isCurrent = false,
  ): LibraryCardModel {
    return { key, kind, id, icon, name, sub, pinned, runStatus, isCurrent, active: isActive(kind, id), payload }
  }

  const sections: LibrarySectionModel[] = []

  if (libTab === 'workflow') {
    // 图2 交互改造：左侧「工作流」Tag 拆两区——上方实例列表（无 + 号；运行中卡片
    // 名称右侧显示运行状态；工作台全局化：全部会话实例 + 当前主会话实例「当前」标签），
    // 下方工作流模板列表（+ 号新建空白模板；全局共享）。
    sections.push({
      key: 'instances',
      title: t.flowInstances,
      plus: false,
      cards: (workflows ?? []).map((item) => card(
        item.id, 'workflow', item.id, '▦', String(item.name ?? ''),
        item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes ?? ''}`,
        {
          label: String(item.name ?? ''),
          onClick: () => onSelectWorkflow(item.id),
          onDrop: () => onSelectWorkflow(item.id),
        },
        false,
        item.runStatus,
        item.sessionId === currentSessionId,
      )),
    })
    sections.push({
      key: 'flowTemplates',
      title: t.flowTemplates,
      plus: true,
      plusKind: 'flowTemplate',
      cards: (flowTemplates ?? []).map((item) => card(
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
          card(
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
      cards: (roleTemplates ?? []).map((item) => card(
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
      cards: (fileTemplates ?? []).map((item) => card(
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
      cards: (databaseTemplates ?? []).map((item) => card(
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
      cards: (stageKinds ?? []).map((card0) => card(
        card0.kind, 'stage', card0.kind, '⬢', String(card0.label), String(t.stagePinHint ?? ''), {
          label: String(card0.label),
          onClick: () => onSelectLib('stage', card0.kind),
          onDrop: (position) => onPlaceStage(card0.kind, position ?? { x: 120, y: 80 }),
        },
      )),
    })
    sections.push({
      key: 'groups',
      title: t.groupTemplates,
      plus: true,
      plusKind: 'group',
      cards: (groupTemplates ?? []).map((item) => card(
        item.id, 'groupTemplate', item.id, '☰', String(item.name ?? ''), truncate(String((item as { collabPrompt?: unknown }).collabPrompt ?? ''), 60), {
          label: String(item.name ?? ''),
          onClick: () => onSelectLib('groupTemplate', item.id),
          onDrop: (position) => onPlaceGroupFromTemplate(item.id, position ?? { x: 120, y: 80 }),
        },
      )),
    })
  }

  // 动态 tab 标签（模式二「其他」无暂停阶段等虽由 stageKinds 体现，但 tab 文案固定四类）
  const tabs: LibraryTabModel[] = TAB_DEFS.map((def) => ({ ...def, label: (t.libTab as Record<string, string>)[def.key] ?? def.label }))

  return { tabs, sections }
}
