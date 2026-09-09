import type { Dispatch } from 'react';
import type { StudioAction } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export interface ServiceControlFace {
    loadServices(sessionId: string): Promise<void>;
    startService(serviceId: string): Promise<void>;
    stopService(serviceId: string): Promise<void>;
}
/** 服务控制面（远端失败抛错，由调用方 toast）。 */
export declare function useServiceControl(dispatch: Dispatch<StudioAction>, remote: RemoteFace): ServiceControlFace;
