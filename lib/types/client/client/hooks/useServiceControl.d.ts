import type { Dispatch } from 'react';
import type { ServiceState } from '../../host/shared/types.js';
import type { WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { StudioAction, CanvasNode, CanvasEdge } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 服务状态响应形状漂移（缺少字符串 id）的稳定错误码；调用方按语义决定提示文案。 */
export declare const SERVICE_STATE_SHAPE_CODE = "SERVICE_STATE_SHAPE";
export interface ServiceControlFace {
    /** 加载服务实例列表（全部会话）；返回加载的条目。 */
    loadServices(): Promise<ServiceState[]>;
    /** 新建本地服务草稿（_draft 标记；首次保存时经 putService 真实入库；目标会话 = 当前主会话）。 */
    createServiceDraft(name: string, sessionId: string): ServiceState;
    /**
     * 模板 → 服务实例（模板拖入画布「创建服务」后转服务实例；深拷贝断引用）。
     * 目标会话由调用方决定（当前主会话 / 新建主会话）；「开启新会话/工作区」为一次性
     * 临时选项，不继承到实例文档（字段已退役）。
     * fallbackName：模板无名称时的默认名（调用方从词典注入）。
     */
    instantiateFromTemplate(template: WorkflowTemplate, targetSessionId: string, fallbackName: string): ServiceState;
    /** 保存服务（草稿入库 / 正式带 revision 更新）。 */
    saveService(service: ServiceState, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<ServiceState | null>;
    /** 启动服务：携带实例归属会话 id 供后端归属校验。 */
    startService(serviceId: string, sessionId: string): Promise<void>;
    /** 停止服务：携带实例归属会话 id 供后端归属校验。 */
    stopService(serviceId: string, sessionId: string): Promise<void>;
}
/**
 * 形状失败错误 → 面向用户的可读文案（其余错误原样透传）。
 * 为什么由调用方映射：hook 不持有词典（界面语言只有调用方知道），它只负责给出稳定错误码；
 * 否则 toastError 会把 `error.message` 原样展示，中文界面会弹出整句英文。
 * 换文案时保留 code，调用方仍可按码分支。
 */
export declare function serviceShapeTextOf(error: unknown, text: string): unknown;
/** 服务控制面（远端失败抛错，由调用方 toast）。 */
export declare function useServiceControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): ServiceControlFace;
