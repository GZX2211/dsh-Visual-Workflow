import type { Dispatch } from 'react';
import type { WorkflowDocument, WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { ServiceState } from '../../host/shared/types.js';
import { type CanvasEdge, type CanvasNode, type LibTab, type StudioAction, type StudioState } from '../studio/studio-state.js';
import type { WorkflowsFace } from './useWorkflows.js';
import type { FlowTemplatesFace } from './useFlowTemplates.js';
import type { TemplatesFace } from './useTemplates.js';
import type { SelectionFace } from './useSelection.js';
import type { UnsavedGuardFace } from './useUnsavedGuard.js';
import type { ServiceControlFace } from './useServiceControl.js';
import type { RemoteFace } from './useRemote.js';
import type { ToastFace } from './useToast.js';
import type { Dict } from '../i18n.js';
/** 画布保存选项。 */
export interface SaveCanvasOptions {
    /**
     * 纯几何改动的自动保存（节点拖动 / 协作组卡片缩放的防抖保存）：
     * 跳过「运行中保存」二次确认、跳过成功 toast（避免拖动即弹窗/刷屏）。
     * 它不是「编排变更」通道：若画布内容没变，宿主侧 diff 也不会向父代理注入。
     */
    auto?: boolean;
    /**
     * 本次要落库的画布内容（缺省 = 当前 state.canvas）。
     * 必须显式传入的场景：同一批 dispatch 之后立即保存的路径（自动布局）——调用方闭包
     * 里的 state.canvas 仍是本次渲染前的旧画布，不传会把旧坐标落盘。
     */
    nodes?: CanvasNode[];
    edges?: CanvasEdge[];
    /**
     * 真实落库成功后的回调（失败/未落库一律不触发）。
     * 「保存并继续」类守卫用它接续原操作：需要二次确认时 saveCanvas 返回 null，
     * 此时只有用户确认且真正落库成功才会走这里。
     */
    onSaved?: () => void;
}
export interface DocumentActionsFace {
    /** 保存当前画布（实例/模板/服务；成功记录已保存快照并 toast）。返回保存成功的文档（类型为三态并集，与原实现推断一致）。 */
    saveCanvas(options?: SaveCanvasOptions): Promise<WorkflowDocument | WorkflowTemplate | ServiceState | null>;
    /**
     * 创建实例（模板态：模板内容存为新实例并切到实例态；实例态等价保存）。
     * 工作台全局化改版：「开启新会话」为一次性临时选项——勾选时先新建主会话，
     * 实例绑定该新会话；未勾选时在**当前主会话**创建，目标会话已有实例则弹
     * 「覆盖旧工作流」二次确认（确认后复用旧实例 id 更新内容）。
     * @param afterCreate 创建/覆盖成功后的回调（异步确认框路径同样触发）；
     *   「运行」入口用它接续启动（因为确认框是异步的，返回值不可依赖）。
     */
    createInstanceFromCanvas(afterCreate?: (created: WorkflowDocument | ServiceState) => void): Promise<WorkflowDocument | null>;
    /** 实例 → 模板（另存为全局共享工作流模板）。 */
    saveCurrentAsFlowTemplate(): Promise<void>;
    openFlowById(id: string): void;
    openServiceById(id: string): void;
    openFlowTemplateById(id: string): void;
    /** 打开工作流/服务（未保存守卫后切换；按 mode 分流）。 */
    selectWorkflow(id: string): void;
    /** 打开工作流模板（未保存守卫后切换）。 */
    selectFlowTemplate(id: string): void;
    /** 新建（工作流 Tab / 角色 / 数据分区 / 协作组分区；+ 号新建模板）。 */
    createNew(tab: LibTab, section?: 'file' | 'database' | 'flowTemplate' | 'group'): void;
}
/** 文档生命周期面（保存失败抛错/提示由保存路径处理）。 */
export declare function useDocumentActions(state: StudioState, dispatch: Dispatch<StudioAction>, guard: UnsavedGuardFace, notify: ToastFace['toast'], toastError: ToastFace['toastError'], workflows: WorkflowsFace, flowTemplates: FlowTemplatesFace, templates: TemplatesFace, selection: SelectionFace, serviceControl: ServiceControlFace, remote: RemoteFace, t: Dict): DocumentActionsFace;
