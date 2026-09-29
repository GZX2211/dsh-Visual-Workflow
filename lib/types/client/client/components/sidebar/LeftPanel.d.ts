import type { Dict } from '../../i18n.js';
import type { LibTab, LibrarySource } from '../../studio/studio-state.js';
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../../host/shared/types.js';
import type { WorkflowTemplate } from '../../../host/shared/graph-model.js';
import type { RoleAssetSummary, WorkflowAssetSummary } from '../../../host/shared/asset-types.js';
export interface LibSelectionInfo {
    kind: 'workflow' | 'workflowTemplate' | 'flowAsset' | 'roleAsset' | 'role' | 'file' | 'database' | 'parentTemplate' | 'stage' | 'groupTemplate' | 'service';
    id: string;
}
export interface DragPayload {
    label: string;
    onClick(): void;
    /**
     * 拖入画布落点回调。缺省 = 该卡片不可拖入画布（历史（已归档）资产：拖入等于让
     * 归档资产重新进入编排，必须先经属性栏「回滚」显式启用）。
     */
    onDrop?(position?: {
        x: number;
        y: number;
    }): void;
    /** 拖拽落点为协作组卡片时：生成节点并直接入组（角色模板）。 */
    onDropIntoGroup?(groupId: string, position?: {
        x: number;
        y: number;
    }): void;
}
export interface LeftPanelProps {
    copy: Dict;
    libTab: LibTab;
    onSetTab(tab: LibTab): void;
    /** 库来源（模版 / 资产）与切换回调。 */
    librarySource: LibrarySource;
    onSetLibrarySource(source: LibrarySource): void;
    /** 搜索关键词（两态共用）与输入回调。 */
    libSearch: string;
    onSetLibSearch(query: string): void;
    open: boolean;
    width: number;
    mode: 'mode1' | 'mode2';
    /** 实例列表（工作台全局化：全部会话实例；每项带 sessionId 供归属判定）。
     * runStatus 为 null 表示无活跃 run（不显示徽标）。 */
    workflows: Array<{
        id: string;
        name: string;
        description?: string;
        nodes?: unknown[];
        runStatus?: string | null;
        sessionId?: string;
    }>;
    /** 当前主会话 id（会话树根）：实例列表中 sessionId 与之匹配的实例打「当前」标签。 */
    currentSessionId: string;
    /** 工作流模板列表（全局共享；按当前 mode 过滤后传入；图2 交互改造）。 */
    flowTemplates: WorkflowTemplate[];
    /** 资产列表（活跃 + 历史（已归档）；资产态左栏数据源）。 */
    assets: {
        workflows: WorkflowAssetSummary[];
        roles: RoleAssetSummary[];
        retiredWorkflows: WorkflowAssetSummary[];
        retiredRoles: RoleAssetSummary[];
    };
    parentTemplate: RoleTemplate | null;
    roleTemplates: RoleTemplate[];
    fileTemplates: FileTemplate[];
    databaseTemplates: DatabaseTemplate[];
    /** 协作组模板列表（全局共享；「其他」Tab 协作组分区，用户批注：+ 新增/点击编辑/删除）。 */
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
    onSelectFlowAsset(id: string): void;
    /** 打开角色资产（属性栏编辑）。 */
    onOpenRoleAsset(id: string): void;
    /** 角色资产拖入画布。 */
    onPlaceRoleAsset(id: string, position: {
        x: number;
        y: number;
    }): void;
    onSelectLib(kind: LibSelectionInfo['kind'], id: string): void;
    onPlaceTemplate(kind: 'role' | 'file' | 'database', id: string, position: {
        x: number;
        y: number;
    }): void;
    /** 角色模板拖入协作组：生成节点并直接入组。 */
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
    /** 协作组模板拖入画布：按模板内容生成协作组节点。 */
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
export declare function LeftPanel(props: LeftPanelProps): import("react").JSX.Element;
