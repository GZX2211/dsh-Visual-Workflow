// src/client/components/sidebar/library-model.ts
//
// 库内容模型构建器（纯函数，无副作用）：把「左侧库」的完整逻辑（来源（模版/资产）、
// 四 Tag 分区、实例/模板/资产/角色/文件/数据库/阶段/协作组卡片、搜索过滤、
// 拖拽 payload、选中高亮判定）提取为一份可复用的数据模型。左侧栏（LeftPanel，
// 竖向列表）与底栏（BottomPanel，横向卡片流）共用同一 builder，保证两份显示的
// 「内容与选中/拖拽逻辑」完全一致。
//
// 单一职责：本文件只负责「从原始列表 + 回调构造卡片模型」，不渲染任何 JSX。
//
// 来源语义（用户裁决）：
//   - 模版态：实例列表 + 工作流模板 / 父代理 + 角色模板 / 文件 + 数据库 / 阶段 + 协作组；
//   - 资产态：工作流资产 / 角色资产，各自再分「活跃资产」与「历史资产（已归档）」两栏，
//     数据与其他 Tag 显示空态提示（V1 资产只含工作流与角色）。
//   - 角色资产的活跃栏**不含内联资产**：内联角色的编辑入口在画布节点上，左栏并排显示
//     会与画布形成两份互相看不出同步关系的视图（用户批注：信息不同步且冗余）；
//     内联资产一旦被多个工作流引用升为共享资产，就会出现在活跃栏。
// 搜索（两态常驻、共用同一关键词）：过滤当前 Tag 下**全部分区**卡片，
// 字段 = 名称 + 描述/角色提示词，大小写不敏感、首尾 trim。
// 折叠：历史资产分栏默认折叠（`collapsedSections` 由视图层持有）；搜索只做过滤，
// 不因命中而自动展开——折叠是一种显式隐藏行为。

import type { Dict } from '../../i18n.js'
import type { LibTab, LibSelKind, LibrarySource } from '../../studio/studio-state.js'
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js'
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js'
import type { RoleAssetSummary, WorkflowAssetSummary } from '../../../host/shared/asset-types.js'
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

/** 资产态「历史资产」分栏 key（左侧栏的折叠状态以这两个 key 为准；底栏不折叠）。 */
export const ASSET_HISTORY_SECTIONS = {
  workflow: 'assetWorkflowHistory',
  role: 'assetRoleHistory',
} as const

/** 分区模型（标题 + 是否显示「＋」新建 + 卡片列表 + 空态文案 + 可折叠性）。 */
export interface LibrarySectionModel {
  key: string
  title: string
  plus: boolean
  plusKind?: 'file' | 'database' | 'flowTemplate' | 'group'
  /** 本分区无卡片时的空态文案（模版态/资产态不同）。 */
  emptyText: string
  /** 是否提供折叠开关（历史资产分栏为 true）。 */
  collapsible?: boolean
  /** 当前是否处于折叠态（折叠时卡片不渲染，仅保留标题与命中数）。 */
  collapsed?: boolean
  cards: LibraryCardModel[]
}

/** Tag 模型（工作流/角色/数据/其他；图标化显示）。 */
export interface LibraryTabModel {
  key: LibTab
  label: string
  icon: string
}

/** 库内容模型（Tab 列表 + 当前 Tag 下的分区列表 + 整页空态）。 */
export interface LibraryModel {
  tabs: LibraryTabModel[]
  sections: LibrarySectionModel[]
  /** 整页空态（资产态数据/其他 Tag、搜索无结果）；null = 无整页空态。 */
  emptyHint: string | null
}

/** builder 输入：原始列表 + 选区 + 全部回调（与 LeftPanel props 高度重合）。 */
export interface LibraryModelInput {
  copy: Dict
  libTab: LibTab
  mode: 'mode1' | 'mode2'
  /** 库来源（模版 / 资产）；缺省模版态。 */
  librarySource?: LibrarySource
  /** 搜索关键词（两态共用；大小写不敏感）。 */
  libSearch?: string
  /** 当前折叠的分区 key（视图层持有；缺省全展开）。 */
  collapsedSections?: readonly string[]
  workflows: Array<{ id: string; name: string; description?: string; nodes?: unknown[]; runStatus?: string | null; sessionId?: string }>
  currentSessionId: string
  flowTemplates: WorkflowTemplate[]
  /** 资产列表（活跃 + 历史（已归档））；缺省空。 */
  assets?: {
    workflows: WorkflowAssetSummary[]
    roles: RoleAssetSummary[]
    retiredWorkflows?: WorkflowAssetSummary[]
    retiredRoles?: RoleAssetSummary[]
  }
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
  /** 打开工作流资产为画布文档（资产态）。 */
  onSelectFlowAsset?(id: string): void
  /** 打开角色资产（资产态属性栏编辑）。 */
  onOpenRoleAsset?(id: string): void
  /** 角色资产拖入画布（生成角色节点并写入来源资产 id）。 */
  onPlaceRoleAsset?(id: string, position: { x: number; y: number }): void
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
    onSelectWorkflow, onSelectFlowTemplate, onSelectFlowAsset, onOpenRoleAsset, onPlaceRoleAsset,
    onSelectLib, onPlaceTemplate, onPlaceTemplateIntoGroup, onPlaceStage, onPlaceGroupFromTemplate,
    onPlaceParent, onCreateNew,
  } = input

  const librarySource: LibrarySource = input.librarySource === 'asset' ? 'asset' : 'template'
  const assets = input.assets ?? { workflows: [], roles: [] }
  const collapsedSections = input.collapsedSections ?? []
  const query = String(input.libSearch ?? '').trim().toLowerCase()
  const searching = query !== ''
  /** 搜索命中判定（任一字段包含关键词即命中；空关键词全命中）。 */
  const hit = (...fields: unknown[]): boolean =>
    !searching || fields.some((field) => String(field ?? '').toLowerCase().includes(query))

  const isActive = (kind: string, id: string): boolean => libSelection?.kind === kind && libSelection?.id === id

  function card(
    key: string, kind: LibSelKind, id: string, icon: string, name: string, sub: string,
    payload: DragPayload, pinned = false, runStatus?: string | null, isCurrent = false,
  ): LibraryCardModel {
    return { key, kind, id, icon, name, sub, pinned, runStatus, isCurrent, active: isActive(kind, id), payload }
  }

  /**
   * 历史资产分栏（可折叠）。
   * 折叠态由视图层持有的 `collapsedSections` 决定：搜索只做过滤，不因命中而自动展开
   * ——«折叠»是一种显式隐藏行为，自动展开会让用户的展开/收起操作失去可预期性。
   */
  function historySection(
    key: string,
    title: string,
    emptyText: string,
    cards: LibraryCardModel[],
  ): LibrarySectionModel {
    return { key, title, plus: false, emptyText, collapsible: true, collapsed: collapsedSections.includes(key), cards }
  }

  const sections: LibrarySectionModel[] = []

  if (librarySource === 'asset') {
    // 资产态：工作流 Tag 列工作流资产、角色 Tag 列角色资产，各自再分「活跃资产」与
    // 「历史资产（已归档）」两栏。归档不是从列表消失，而是从活跃栏转移到默认折叠的历史栏；
    // 历史栏的卡片可点击打开（做版本迭代或回滚重新启用），但不可拖入画布
    // ——拖入等于让已归档资产重新进入编排，必须先经「回滚」显式启用。
    if (libTab === 'workflow') {
      sections.push({
        key: 'assetWorkflows',
        title: t.assetActiveSection,
        plus: false,
        emptyText: t.assetEmptyHint,
        cards: (assets.workflows ?? [])
          .filter((item) => hit(item.name, item.description))
          .map((item) => card(
            item.assetId, 'flowAsset', item.assetId, '▦', String(item.name ?? ''),
            item.description ? truncate(item.description, 60) : `v${item.versionId}`,
            {
              label: String(item.name ?? ''),
              // 工作流资产 = 画布文档：点击与拖入都「打开为资产态画布」
              onClick: () => onSelectFlowAsset?.(item.assetId),
              onDrop: () => onSelectFlowAsset?.(item.assetId),
            },
          )),
      })
      sections.push(historySection(
        ASSET_HISTORY_SECTIONS.workflow, t.assetHistorySection, t.assetHistoryEmpty,
        (assets.retiredWorkflows ?? [])
          .filter((item) => hit(item.name, item.description))
          .map((item) => card(
            item.assetId, 'flowAsset', item.assetId, '▦', String(item.name ?? ''),
            item.description ? truncate(item.description, 60) : `v${item.versionId}`,
            {
              label: String(item.name ?? ''),
              onClick: () => onSelectFlowAsset?.(item.assetId),
            },
          )),
      ))
    } else if (libTab === 'role') {
      sections.push({
        key: 'assetRoles',
        title: t.assetActiveSection,
        plus: false,
        emptyText: t.assetEmptyHint,
        cards: (assets.roles ?? [])
          // 内联角色资产不在左栏显示：它的编辑入口在画布节点上，两侧并排会形成
          // 看不出同步关系的两份视图；升为共享资产后自然出现在这里
          .filter((item) => item.roleAssetType !== 'inline')
          // 搜索命中 = 名称 + 职责摘要（summary = Active 版本提示词前 60 字；模版态行为不变）
          .filter((item) => hit(item.name, item.summary))
          .map((item) => card(
            item.assetId, 'roleAsset', item.assetId, '◆', String(item.name ?? ''),
            // 副行 = 角色资产种类（父代理资产直接标注父代理；其余按 standalone/inline/shared）
            item.kind === 'parent'
              ? t.parentAgent
              : String((t.roleAssetType as Record<string, string>)[item.roleAssetType] || `v${item.versionId}`),
            {
              label: String(item.name ?? ''),
              onClick: () => onOpenRoleAsset?.(item.assetId),
              onDrop: (position) => onPlaceRoleAsset?.(item.assetId, position ?? { x: 120, y: 80 }),
            },
          )),
      })
      sections.push(historySection(
        ASSET_HISTORY_SECTIONS.role, t.assetHistorySection, t.assetHistoryEmpty,
        (assets.retiredRoles ?? [])
          .filter((item) => hit(item.name, item.summary))
          .map((item) => card(
            item.assetId, 'roleAsset', item.assetId, '◆', String(item.name ?? ''),
            item.kind === 'parent'
              ? t.parentAgent
              : String((t.roleAssetType as Record<string, string>)[item.roleAssetType] || `v${item.versionId}`),
            {
              label: String(item.name ?? ''),
              onClick: () => onOpenRoleAsset?.(item.assetId),
            },
          )),
      ))
    }
  } else if (libTab === 'workflow') {
    // 图2 交互改造：左侧「工作流」Tag 拆两区——上方实例列表（无 + 号；运行中卡片
    // 名称右侧显示运行状态；工作台全局化：全部会话实例 + 当前主会话实例「当前」标签），
    // 下方工作流模板列表（+ 号新建空白模板；全局共享）。
    sections.push({
      key: 'instances',
      title: t.flowInstances,
      plus: false,
      emptyText: t.libEmptyTemplates,
      cards: (workflows ?? [])
        .filter((item) => hit(item.name, item.description))
        .map((item) => card(
          item.id, 'workflow', item.id, '▦', String(item.name ?? ''),
          item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes}`,
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
      emptyText: t.libEmptyTemplates,
      cards: (flowTemplates ?? [])
        .filter((item) => hit(item.name, item.description))
        .map((item) => card(
          item.id, 'workflowTemplate', item.id, '▦', String(item.name ?? ''),
          item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes}`,
          {
            label: String(item.name ?? ''),
            onClick: () => onSelectFlowTemplate(item.id),
            onDrop: () => onSelectFlowTemplate(item.id),
          },
        )),
    })
  } else if (libTab === 'role') {
    if (parentTemplate && hit(parentTemplate.name, parentTemplate.systemPrompt)) {
      sections.push({
        key: 'parent',
        title: t.parentAgent,
        plus: false,
        emptyText: t.libEmptyTemplates,
        cards: [
          card(
            parentTemplate.id, 'parentTemplate', parentTemplate.id, '父', String(parentTemplate.name ?? t.parentAgent),
            roleSubline(parentTemplate), {
              label: String(parentTemplate.name ?? t.parentAgent),
              onClick: () => onSelectLib('parentTemplate', parentTemplate.id),
              onDrop: (position) => onPlaceParent(parentTemplate.id, position ?? { x: 120, y: 80 }),
            },
            // pinned 必须为 false：父代理模板卡不是「钉住」的对象——旧代码把第 9 个位置
            // 参数传了 true，导致 LeftPanel 常驻渲染 is-pinned 高亮（P4 修复）。
            false,
          ),
        ],
      })
    }
    sections.push({
      key: 'roles',
      title: t.roleTemplates,
      plus: true,
      emptyText: t.libEmptyTemplates,
      cards: (roleTemplates ?? [])
        .filter((item) => hit(item.name, item.systemPrompt))
        .map((item) => card(
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
      emptyText: t.libEmptyTemplates,
      cards: (fileTemplates ?? [])
        .filter((item) => hit(item.name, item.content, item.fileName))
        .map((item) => card(
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
      emptyText: t.libEmptyTemplates,
      cards: (databaseTemplates ?? [])
        .filter((item) => hit(item.name, item.description))
        .map((item) => card(
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
      emptyText: t.libEmptyTemplates,
      cards: (stageKinds ?? [])
        .filter((item) => hit(item.label))
        .map((card0) => card(
          card0.kind, 'stage', card0.kind, '⬢', String(card0.label), String(t.stagePinHint), {
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
      emptyText: t.libEmptyTemplates,
      cards: (groupTemplates ?? [])
        .filter((item) => hit(item.name, (item as { collabPrompt?: unknown }).collabPrompt))
        .map((item) => card(
          item.id, 'groupTemplate', item.id, '☰', String(item.name ?? ''), truncate(String((item as { collabPrompt?: unknown }).collabPrompt ?? ''), 60), {
            label: String(item.name ?? ''),
            onClick: () => onSelectLib('groupTemplate', item.id),
            onDrop: (position) => onPlaceGroupFromTemplate(item.id, position ?? { x: 120, y: 80 }),
          },
        )),
    })
  }

  // 整页空态判定（顺序即优先级）：
  //   ① 资产态的数据/其他 Tag 无资产分类 → 「该分类暂无资产」；
  //   ② 搜索无命中 → 「没有匹配的条目」；
  //   ③ 其余情况由分区自身的 emptyText 表达。
  let emptyHint: string | null = null
  if (librarySource === 'asset' && (libTab === 'data' || libTab === 'other')) emptyHint = t.assetListNotSupported
  const matched = sections.some((section) => section.cards.length > 0)
  if (emptyHint === null && searching && !matched) emptyHint = t.searchNoResult

  // 搜索是「过滤」语义：无命中的分区不显示（避免出现「暂无模板，点击 + 新建」的误导空态）
  const visible = searching ? sections.filter((section) => section.cards.length > 0) : sections

  // 动态 tab 标签（模式二「其他」无暂停阶段等虽由 stageKinds 体现，但 tab 文案固定四类）
  const tabs: LibraryTabModel[] = TAB_DEFS.map((def) => ({ ...def, label: (t.libTab as Record<string, string>)[def.key] ?? def.label }))

  return { tabs, sections: visible, emptyHint }
}
