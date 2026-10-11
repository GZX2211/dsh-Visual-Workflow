import { type BodyRequest, type JsonResponseSink } from '../http-io.js';
/**
 * GUI 请求体上限分级（K2 用户裁决：本 API 仅本机可信，但要按端点收敛资源占用）。
 * 分级体现的是端点载荷形状，不是「统一成一个值」——二进制/导入档必须保留 64MB 既有能力。
 */
export declare const GUI_BODY_LIMIT: {
    /** 无参端点（端点方法不读 args）：只承载空体或 `{"args":{}}`。 */
    readonly argsFree: number;
    /** 常规端点：id 与短参数。 */
    readonly normal: number;
    /** 整份文档端点：工作流/服务/模板/资产文档整体上送。 */
    readonly document: number;
    /** 二进制与导入包端点：fileUpload 的 base64 与 bundle JSON。 */
    readonly binary: number;
};
/** 端点 → 请求体上限（未登记端点按常规档，未知端点亦不会拿到 64MB）。 */
export declare function guiBodyLimitOf(endpoint: string): number;
/** GUI 请求头最小面（官方 webServer 的 req.headers 收窄）。 */
export type GuiRequestHeaders = Record<string, string | string[] | undefined>;
/**
 * 来源校验（K2 用户裁决：GUI API「仅本机可信」，无应用层鉴权、不引入 token）。
 *
 * 只拦「浏览器跨站发起」这一类请求，不改客户端调用方式：
 *   - 有 `Sec-Fetch-Site` 时必须是 `same-origin` / `none`（同站跨端口 = `same-site` 一并拒绝）；
 *   - 无 `Sec-Fetch-Site` 时（非浏览器客户端、旧浏览器）：有 `Origin` 则要求主机与 `Host`
 *     一致，或为回环地址（本地开发代理）；
 *   - 两者都没有（curl/本地脚本）放行——信任边界就是本机进程，本层不承担进程鉴权。
 */
export declare function guiRequestTrust(headers: GuiRequestHeaders | undefined): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** HTTP 错误（status 供路由层写响应；code 供 client 分支处理）。 */
export declare class HttpError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(status: number, message: string, code?: string);
}
export declare function httpError(status: number, message: string, code?: string): HttpError;
/** 读取请求体（JSON 文本；超限 413）。请求流异常以 RequestStreamError 拒绝（路由层映射 400）。 */
export declare function readBody(req: BodyRequest, limit?: number): Promise<string>;
export declare function sendJson(res: JsonResponseSink, status: number, payload: unknown): void;
