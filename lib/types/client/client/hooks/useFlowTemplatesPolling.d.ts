import type { Dispatch } from 'react';
import type { WorkflowTemplate } from '../../host/shared/graph-model.js';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 模板列表轮询间隔（模板变更频率低；比活跃 run 的 2s 慢，降低空转）。 */
export declare const FLOW_TEMPLATES_POLL_MS = 5000;
/**
 * 服务端模板列表签名（id + revision + updatedAt，排序后拼接）。
 * 用途：无变化时跳过 dispatch，避免每轮都替换列表数组触发无谓重渲染。
 * 纯函数，便于单测。
 */
export declare function flowTemplatesSignature(items: readonly WorkflowTemplate[]): string;
/** 轮询 effect：挂载即拉一次，随后定时拉取；仅签名变化时 dispatch。 */
export declare function useFlowTemplatesPolling(dispatch: Dispatch<StudioAction>, remote: RemoteFace): void;
