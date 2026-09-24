/** 单轮任务上下文：signal/timeoutMs 供远端调用取消与超时；isCurrent() 判定结果是否仍属最新一轮。 */
export interface PollingContext {
    signal: AbortSignal;
    timeoutMs: number;
    isCurrent(): boolean;
}
export interface PollingOptions {
    /** 轮询间隔（毫秒）。 */
    intervalMs: number;
    /** 单轮远端调用超时（毫秒）；缺省 POLL_REMOTE_TIMEOUT_MS。 */
    timeoutMs?: number;
    /** 是否启用（false 时立即停止并清理，不发起请求）。 */
    enabled?: boolean;
}
/**
 * 周期轮询 effect。deps 变化即重建轮询（新文档/新会话/新开关）；
 * task 取最新渲染闭包（经 ref），无需调用方自行 memo。
 */
export declare function usePolling(task: (context: PollingContext) => Promise<void>, options: PollingOptions, deps: React.DependencyList): void;
