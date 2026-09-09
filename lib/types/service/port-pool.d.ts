/** 端口池基础端口（与配置默认值一致；向上探测）。 */
export declare const SERVICE_PORT_BASE = 7860;
/** 端口池上限（防配置错误导致无限探测）。 */
export declare const SERVICE_PORT_MAX = 65535;
/** 单次探测的候选上限（超出视为端口池耗尽）。 */
export declare const PORT_PROBE_LIMIT = 200;
export interface ProbeOptions {
    /** 监听主机（默认回环；0.0.0.0 场景由部署配置决定）。 */
    host?: string;
    /** 探测候选上限（测试可收紧）。 */
    limit?: number;
    /** 时钟注入（测试可控）。 */
    now?: () => number;
}
/** 空闲端口探测：从 base 起逐一尝试，返回第一个可绑定端口。 */
export declare function findFreePort(base: number, options?: ProbeOptions): Promise<number>;
/** 单端口探测：bind 成功立即释放，返回是否空闲。 */
export declare function probePort(port: number, host?: string): Promise<boolean>;
