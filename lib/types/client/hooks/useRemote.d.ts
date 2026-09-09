export interface RemoteFace {
    /** POST /visual-workflow/<endpoint>，body { args }，返回 value。 */
    call(endpoint: string, args?: Record<string, unknown>): Promise<unknown>;
}
/** 远端调用面（remoteCall 为纯函数，hook 仅提供稳定引用）。 */
export declare function useRemote(): RemoteFace;
