import type { Dispatch } from 'react';
import type { ServiceState } from '../../host/shared/types.js';
import type { WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface ServiceControlFace {
    /** 加载服务实例列表（全部会话）；返回加载的条目。 */
    loadServices(): Promise<ServiceState[]>;
    /** 新建本地服务草稿（_draft 标记；首次保存时经 putService 真实入库；目标会话 = 当前主会话）。 */
    createServiceDraft(name: string, sessionId: string): ServiceState;
    /**
     * 模板 → 服务实例（图2 交互改造：模板拖入画布「创建服务」后转服务实例；深拷贝断引用）。
     * 目标会话由调用方决定（当前主会话 / 新建主会话）；「开启新会话/工作区」为一次性
     * 临时选项，不继承到实例文档（字段已退役）。
     */
    instantiateFromTemplate(template: WorkflowTemplate, targetSessionId: string): ServiceState;
    /** 保存服务（草稿入库 / 正式带 revision 更新）。 */
    saveService(service: ServiceState, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<ServiceState | null>;
    /** 启动服务：携带实例归属会话 id 供后端归属校验。 */
    startService(serviceId: string, sessionId: string): Promise<void>;
    /** 停止服务：携带实例归属会话 id 供后端归属校验。 */
    stopService(serviceId: string, sessionId: string): Promise<void>;
}
/** 服务控制面（远端失败抛错，由调用方 toast）。 */
export declare function useServiceControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): ServiceControlFace;
