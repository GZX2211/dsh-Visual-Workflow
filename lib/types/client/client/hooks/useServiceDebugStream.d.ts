import type { RemoteFace } from './useRemote.js';
/** 服务调试面（组件消费）。 */
export interface ServiceDebugFace {
    /** 累积的流式输出（含错误行）。 */
    output: string;
    /** 是否有进行中的调试流。 */
    streaming: boolean;
    /** 发送一条调试问题（空串 / 非运行态 / 已有流在飞时忽略）。 */
    send(prompt: string): void;
    /** 主动停止当前流。 */
    stop(): void;
}
export interface ServiceDebugOptions {
    /** 调试目标服务 id。 */
    serviceId: string;
    /** 调试会话归属（Host 侧组装 `debug-<sessionId>` userId）。 */
    sessionId: string;
    /** 服务是否处于运行态（false 时中止在途流并拒绝新的发送）。 */
    enabled: boolean;
    /** 流内错误行前缀（来自词典，如「[错误] 」）。 */
    errorPrefix: string;
}
export declare function useServiceDebugStream(remote: RemoteFace, options: ServiceDebugOptions): ServiceDebugFace;
