/** 编排器错误：稳定 code（工具层转 isError 工具结果/测试断言共用）。 */
export declare class WfError extends Error {
    readonly code: string;
    constructor(message: string, code: string, extras?: Record<string, unknown>);
}
/** 错误消息提取（Error 或任意值）。 */
export declare function messageOf(error: unknown): string;
