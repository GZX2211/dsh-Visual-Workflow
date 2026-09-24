import type { Dispatch } from 'react';
import type { ServiceState } from '../../host/shared/types.js';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
/** 服务状态轮询间隔（与活跃 run 徽标同频；服务状态变化频率低）。 */
export declare const SERVICE_STATUS_POLL_MS = 2000;
/**
 * 需要跟踪的服务实例（非 stopped；停止态无进程可查，且崩溃恢复由启动动作驱动）。
 * 纯函数，便于单测。
 */
export declare function trackedServicesOf(services: readonly ServiceState[]): ServiceState[];
/** 跟踪签名（id + status + port）：签名变化即重建轮询（新增/移除服务或状态跳变）。 */
export declare function trackedServicesSignature(services: readonly ServiceState[]): string;
export declare function useServiceStatusPolling(state: StudioState, dispatch: Dispatch<StudioAction>, remote: RemoteFace): void;
