import type { Dict } from '../../i18n.js';
import type { LibTab, LibSelKind, LibrarySource } from '../../studio/studio-state.js';
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js';
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js';
import type { ExperienceEntry, RoleAssetSummary, WorkflowAssetSummary } from '../../../host/shared/asset-types.js';
import type { DragPayload, LibSelectionInfo } from './LeftPanel.js';
/** 单张卡片模型（拖拽 payload + 展示字段；底栏只取 name，左栏取全部）。 */
export interface LibraryCardModel {
    key: string;
    kind: LibSelKind;
    id: string;
    icon: string;
    name: string;
    sub: string;
    pinned?: boolean;
    runStatus?: string | null;
    isCurrent?: boolean;
    active: boolean;
    payload: DragPayload;
}
/** 资产态「历史」分栏 key（左侧栏的折叠状态以这几个 key 为准；底栏不折叠）。
 *  经验与资产同属资产态：归档后的条目同样落入默认折叠的历史分栏。 */
export declare const ASSET_HISTORY_SECTIONS: {
    readonly workflow: "assetWorkflowHistory";
    readonly role: "assetRoleHistory";
    readonly experience: "assetExperienceHistory";
};
/** 分区模型（标题 + 是否显示「＋」新建 + 卡片列表 + 空态文案 + 可折叠性）。 */
export interface LibrarySectionModel {
    key: string;
    title: string;
    plus: boolean;
    plusKind?: 'file' | 'database' | 'flowTemplate' | 'group';
    /** 本分区无卡片时的空态文案（模版态/资产态不同）。 */
    emptyText: string;
    /** 是否提供折叠开关（历史资产分栏为 true）。 */
    collapsible?: boolean;
    /** 当前是否处于折叠态（折叠时卡片不渲染，仅保留标题与命中数）。 */
    collapsed?: boolean;
    cards: LibraryCardModel[];
}
/** Tag 模型（工作流/角色/数据/其他；图标化显示）。 */
export interface LibraryTabModel {
    key: LibTab;
    label: string;
    icon: string;
}
/** 库内容模型（Tab 列表 + 当前 Tag 下的分区列表 + 整页空态）。 */
export interface LibraryModel {
    tabs: LibraryTabModel[];
    sections: LibrarySectionModel[];
    /** 整页空态（资产态数据/其他 Tag、搜索无结果）；null = 无整页空态。 */
    emptyHint: string | null;
}
/** builder 输入：原始列表 + 选区 + 全部回调（与 LeftPanel props 高度重合）。 */
export interface LibraryModelInput {
    copy: Dict;
    libTab: LibTab;
    mode: 'mode1' | 'mode2';
    /** 库来源（模版 / 资产）；缺省模版态。 */
    librarySource?: LibrarySource;
    /** 搜索关键词（两态共用；大小写不敏感）。 */
    libSearch?: string;
    /** 当前折叠的分区 key（视图层持有；缺省全展开）。 */
    collapsedSections?: readonly string[];
    workflows: Array<{
        id: string;
        name: string;
        description?: string;
        nodes?: unknown[];
        runStatus?: string | null;
        sessionId?: string;
    }>;
    currentSessionId: string;
    flowTemplates: WorkflowTemplate[];
    /** 资产列表（活跃 + 历史（已归档））；缺省空。 */
    assets?: {
        workflows: WorkflowAssetSummary[];
        roles: RoleAssetSummary[];
        retiredWorkflows?: WorkflowAssetSummary[];
        retiredRoles?: RoleAssetSummary[];
    };
    /** 经验列表（资产态「数据」Tab 以「经验」呈现；活跃与已归档一并传入）。 */
    experiences?: ExperienceEntry[];
    parentTemplate: RoleTemplate | null;
    roleTemplates: RoleTemplate[];
    fileTemplates: FileTemplate[];
    databaseTemplates: DatabaseTemplate[];
    groupTemplates: GroupTemplate[];
    stageKinds: Array<{
        kind: string;
        label: string;
    }>;
    libSelection: LibSelectionInfo | null;
    modeName(presetId: string | null | undefined): string;
    onSelectWorkflow(id: string): void;
    onSelectFlowTemplate(id: string): void;
    /** 打开工作流资产为画布文档（资产态）。 */
    onSelectFlowAsset?(id: string): void;
    /** 打开角色资产（资产态属性栏编辑）。 */
    onOpenRoleAsset?(id: string): void;
    /** 角色资产拖入画布（生成角色节点并写入来源资产 id）。 */
    onPlaceRoleAsset?(id: string, position: {
        x: number;
        y: number;
    }): void;
    /** 打开经验（资产态属性栏编辑；经验没有画布形态，故无拖入入口）。 */
    onOpenExperience?(id: string): void;
    onSelectLib(kind: LibSelectionInfo['kind'], id: string): void;
    onPlaceTemplate(kind: 'role' | 'file' | 'database', id: string, position: {
        x: number;
        y: number;
    }): void;
    onPlaceTemplateIntoGroup(kind: 'role', id: string, groupId: string, position: {
        x: number;
        y: number;
    }): void;
    onPlaceStage(kind: string, position: {
        x: number;
        y: number;
    }): void;
    onPlaceGroup(position: {
        x: number;
        y: number;
    }): void;
    onPlaceGroupFromTemplate(id: string, position: {
        x: number;
        y: number;
    }): void;
    onPlaceParent(id: string, position: {
        x: number;
        y: number;
    }): void;
    onCreateNew(tab: LibTab, section?: 'file' | 'database' | 'flowTemplate' | 'group'): void;
}
/** 构造库内容模型（纯函数；不渲染，不读 DOM/时钟）。 */
export declare function buildLibraryModel(input: LibraryModelInput): LibraryModel;
