import { type RemoteCallOptions } from '../lib/remote.js';
export interface RemoteFace {
    /** POST /visual-workflow/<endpoint>，body { args }，返回 value（超时/取消见 options）。 */
    call(endpoint: string, args?: Record<string, unknown>, options?: RemoteCallOptions): Promise<unknown>;
    /** SSE 流式调用（服务调试）；生命周期由 signal 掌握。 */
    stream(endpoint: string, args: Record<string, unknown>, onLine: (line: string) => void, signal?: AbortSignal): Promise<void>;
}
/** 远端调用面（remoteCall/streamCall 为纯函数，hook 仅提供稳定引用）。 */
export declare function useRemote(): RemoteFace;
