import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
import type { WorkflowsFace } from './useWorkflows.js';
import type { FlowTemplatesFace } from './useFlowTemplates.js';
import type { TemplatesFace } from './useTemplates.js';
import type { ServiceControlFace } from './useServiceControl.js';
import type { ToastFace } from './useToast.js';
import type { Dict } from '../i18n.js';
/** 自动选中实例判定（当前主会话实例列表 + 全量活跃 run；运行中>暂停>最新）。 */
type PickInitialInstance = (currentSessionInstances: Array<{
    id: string;
    name?: string;
    updatedAt?: string;
}>, activeRuns: Array<{
    flowId: string;
    status: string;
}>) => string | null;
/** 初始化加载（工作台全局化：挂载时执行一次；列表为全量跨会话）。 */
export declare function useStudioBoot(state: StudioState, dispatch: Dispatch<StudioAction>, _notify: ToastFace['toast'], toastError: ToastFace['toastError'], _t: Dict, remote: RemoteFace, workflows: WorkflowsFace, flowTemplates: FlowTemplatesFace, templates: TemplatesFace, serviceControl: ServiceControlFace, pickInitialInstance: PickInitialInstance): void;
/**
 * 进入工作台自动选中实例（工作台全局化改版）：从**当前主会话**的实例列表中
 * 选出默认打开的实例 id。规则（优先级）：
 *   1. 正在运行的实例——activeRuns 中 status='running' 且归属当前会话的 flowId；
 *   2. 已暂停的实例——status='paused' 的当前会话实例；
 *   3. 实例列表第一个（后端按 updatedAt 倒序 = 最新）；
 * 校验：activeRuns 的 flowId 必须在该实例列表中（否则忽略该条目）；
 * 当前会话无实例时由调用方提前 return（保持空白画布），本函数入参即已过滤后
 * 的当前会话实例列表。
 */
export declare function pickInitialInstanceForSession(currentSessionInstances: Array<{
    id: string;
    name?: string;
    updatedAt?: string;
}>, activeRuns: Array<{
    flowId: string;
    status: string;
}>): string | null;
export {};
