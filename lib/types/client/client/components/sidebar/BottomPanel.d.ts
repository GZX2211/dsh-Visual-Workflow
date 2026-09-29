import type { Dict } from '../../i18n.js';
import type { LibTab, LibrarySource } from '../../studio/studio-state.js';
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js';
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js';
import type { ExperienceEntry, RoleAssetSummary, WorkflowAssetSummary } from '../../../host/shared/asset-types.js';
import type { DragPayload, LibSelectionInfo } from './LeftPanel.js';
export interface BottomPanelProps {
    copy: Dict;
    libTab: LibTab;
    onSetTab(tab: LibTab): void;
    /** 库来源（模版 / 资产）：只读消费（切换入口在左栏底部）。 */
    librarySource: LibrarySource;
    onSetLibrarySource(source: LibrarySource): void;
    libSearch: string;
    onSetLibSearch(query: string): void;
    open: boolean;
    height: number;
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
    assets: {
        workflows: WorkflowAssetSummary[];
        roles: RoleAssetSummary[];
        retiredWorkflows: WorkflowAssetSummary[];
        retiredRoles: RoleAssetSummary[];
    };
    /** 经验列表（资产态「数据」Tag 以「经验」呈现；活跃与已归档一并传入）。 */
    experiences: ExperienceEntry[];
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
    onSelectFlowAsset(id: string): void;
    onOpenRoleAsset(id: string): void;
    /** 打开经验（资产态属性栏编辑；经验没有画布形态，故无拖入入口）。 */
    onOpenExperience(id: string): void;
    onPlaceRoleAsset(id: string, position: {
        x: number;
        y: number;
    }): void;
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
    onBeginDrag(event: React.PointerEvent, payload: DragPayload): void;
}
export declare function BottomPanel(props: BottomPanelProps): import("react").JSX.Element;
