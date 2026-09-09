import type { Dict } from '../../i18n.js';
import type { LibTab, LibSelKind } from '../../studio/studio-state.js';
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js';
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js';
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
/** 分区模型（标题 + 是否显示「＋」新建 + 卡片列表）。 */
export interface LibrarySectionModel {
    key: string;
    title: string;
    plus: boolean;
    plusKind?: 'file' | 'database' | 'flowTemplate' | 'group';
    cards: LibraryCardModel[];
}
/** Tag 模型（工作流/角色/数据/其他；图标化显示）。 */
export interface LibraryTabModel {
    key: LibTab;
    label: string;
    icon: string;
}
/** 库内容模型（Tab 列表 + 当前 Tag 下的分区列表）。 */
export interface LibraryModel {
    tabs: LibraryTabModel[];
    sections: LibrarySectionModel[];
}
/** builder 输入：原始列表 + 选区 + 全部回调（与 LeftPanel props 高度重合）。 */
export interface LibraryModelInput {
    copy: Dict;
    libTab: LibTab;
    mode: 'mode1' | 'mode2';
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
