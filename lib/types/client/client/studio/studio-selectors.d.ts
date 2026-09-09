import type { StudioState, EditorData } from './studio-types.js';
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { ServiceState } from '../../host/shared/types.js';
/** 当前工作流文档（内存列表优先；草稿回退）。 */
export declare function currentFlowOf(state: StudioState): WorkflowDocument | null;
/** 当前工作流模板文档（模板态画布）。 */
export declare function currentFlowTemplateOf(state: StudioState): WorkflowTemplate | null;
/** 当前服务文档。 */
export declare function currentServiceOf(state: StudioState): ServiceState | null;
/** 当前运行状态（running 判定）。 */
export declare function isRunningOf(state: StudioState): boolean;
/** 编辑器数据（右侧面板渲染源）。 */
export declare function editorDataOf(state: StudioState): EditorData | null;
/** 折叠/切换循环长度（共 3 态：左展开→切换底栏→收起底栏→左展开）。 */
export declare const PANEL_CYCLE_LEN = 3;
/** 循环位置枚举：0=左栏展开 1=底栏展开 2=收起底栏/左栏(全隐)。 */
export declare const PANEL_MODE_LEFT = 0;
export declare const PANEL_MODE_BOTTOM = 1;
export declare const PANEL_MODE_NONE = 2;
/** 折叠/切换下一步循环位置（左展→切换底栏→收起底栏→左展）。 */
export declare function nextPanelMode(mode: number): number;
/** 左栏是否展开（循环位置 0）。 */
export declare function leftPanelOpenOf(state: StudioState): boolean;
/** 底栏是否展开（循环位置 1）。 */
export declare function bottomPanelOpenOf(state: StudioState): boolean;
/** 是否处于「全隐」态（循环位置 2：收起底栏/左栏，仅画布）。 */
export declare function panelsFullyCollapsedOf(state: StudioState): boolean;
/**
 * 右侧属性栏是否显示：默认隐藏（折叠），仅当选中「具备属性」的对象时才展开。
 * 判定 = 编辑对象存在且其属性栏类型不是「阶段」（阶段节点/侧栏阶段卡片不具备属性，不弹）；
 * 其余（实例/工作流/服务/模板/角色/文件/数据库/协作组/连线/画布角色节点含父代理节点/虚拟节点）都弹。
 * 注意：父代理模板也具备属性（属性栏显示模板内容），此处一并弹出。
 */
export declare function inspectorOpenOf(state: StudioState): boolean;
