/** 远端错误的稳定码（无码 = 传输/解析失败）。 */
export declare function remoteErrorCodeOf(error: unknown): string;
/** 远端错误的可读文案：Error 用 message；非 Error 用字符串原文；两者皆缺回退错误码。 */
export declare function remoteErrorMessageOf(error: unknown): string;
